'use client';

/**
 * One voice note, from the permission prompt to a finished clip.
 *
 * The states a recorder actually has, and the ones this hook exposes:
 *
 *   idle      nothing is happening
 *   starting  the permission prompt is up, or the device is warming up
 *   recording the clock is running and the meter is live
 *   ready     a clip exists, waiting to be sent or thrown away
 *
 * Three details are the difference between this working and merely looking like
 * it works:
 *
 * - **the stream is released.** A live microphone leaves the browser's recording
 *   indicator on and keeps the device busy for every other tab. Every path out
 *   of this hook — stop, cancel, an error mid-recording, unmount — stops the
 *   tracks.
 * - **the clock is not the recorder's.** `elapsedMs` is measured from
 *   `Date.now()` at the moment recording began, so the timer stays truthful even
 *   if the recorder throttles in a background tab.
 * - **there is no length cap.** A voice note ends when the person presses stop,
 *   and not before — the panel is where a long explanation is the normal case,
 *   so the recorder has no clock of its own to run out of. The elapsed timer is
 *   the only thing counting.
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {explainMediaError, pickAudioMimeType, recordingFileName} from '@/lib/media';

export type RecorderState = 'idle' | 'starting' | 'recording' | 'ready';

/** A finished voice note, still local — nothing has been uploaded yet. */
export type RecordedClip = {
  file: File;
  /** Object URL for playing it back before it is sent. */
  url: string;
  mime: string;
  bytes: number;
  durationMs: number;
};

export type Recorder = {
  state: RecorderState;
  elapsedMs: number;
  clip: RecordedClip | null;
  error: string | null;
  /** 0–1, the loudest moment of the last fraction of a second of microphone. */
  level: number;
  start: () => void;
  stop: () => void;
  /** Stop, release everything and keep nothing. */
  cancel: () => void;
  /** Throw the finished clip away. */
  discard: () => void;
  dismissError: () => void;
};

export const useRecorder = (): Recorder => {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const levelRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  /** Why the recorder is stopping, so `onstop` knows what to do about it. */
  const intentRef = useRef<'finish' | 'cancel'>('finish');

  /** Hands the microphone back. Safe to call twice. */
  const release = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (levelRef.current !== null) {
      window.clearInterval(levelRef.current);
      levelRef.current = null;
    }
    if (audioRef.current) {
      void audioRef.current.close().catch(() => {});
      audioRef.current = null;
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setLevel(0);
  }, []);

  // Leaving the screen mid-recording must not leave a red dot on the tab.
  useEffect(() => release, [release]);

  /** The loudest sample in the current window — enough for a level meter. */
  const watchLevel = useCallback((live: MediaStream) => {
    const Context =
      window.AudioContext ||
      (window as unknown as {webkitAudioContext?: typeof AudioContext})
        .webkitAudioContext;
    if (!Context) {
      return;
    }
    const context = new Context();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(live).connect(analyser);
    audioRef.current = context;
    const samples = new Uint8Array(analyser.fftSize);
    levelRef.current = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (let index = 0; index < samples.length; index += 1) {
        peak = Math.max(peak, Math.abs(samples[index] - 128) / 128);
      }
      // A little gain, so quiet speech still moves the bar.
      setLevel(Math.min(1, peak * 1.8));
    }, 100);
  }, []);

  const start = useCallback(() => {
    if (state === 'starting' || state === 'recording') {
      return;
    }
    setError(null);
    setClip(current => {
      if (current) {
        URL.revokeObjectURL(current.url);
      }
      return null;
    });
    setElapsedMs(0);
    intentRef.current = 'finish';
    setState('starting');

    void (async () => {
      let live: MediaStream;
      try {
        live = await navigator.mediaDevices.getUserMedia({
          audio: {echoCancellation: true, noiseSuppression: true},
        });
      } catch (failure) {
        setState('idle');
        setError(explainMediaError(failure));
        return;
      }

      // Cancelled while the permission prompt was up.
      if (intentRef.current === 'cancel') {
        live.getTracks().forEach(track => track.stop());
        setState('idle');
        return;
      }

      streamRef.current = live;
      watchLevel(live);

      const mime = pickAudioMimeType();
      const recorder = mime
        ? new MediaRecorder(live, {mimeType: mime})
        : new MediaRecorder(live);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        release();
        setState('idle');
        setError('The recorder stopped unexpectedly. Try again.');
        intentRef.current = 'finish';
      };

      recorder.onstop = () => {
        const cancelling = intentRef.current === 'cancel';
        const type = recorder.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunksRef.current, {type});
        const durationMs = Date.now() - startedAtRef.current;
        chunksRef.current = [];
        release();
        if (cancelling) {
          setState('idle');
          return;
        }
        if (!blob.size) {
          setState('idle');
          setError('Nothing was captured — check the microphone and try again.');
          return;
        }
        setElapsedMs(durationMs);
        setClip({
          file: new File([blob], recordingFileName(type), {type}),
          url: URL.createObjectURL(blob),
          mime: type,
          bytes: blob.size,
          durationMs,
        });
        setState('ready');
      };

      // A timeslice, so a long note is delivered in pieces rather than one
      // buffer at the end.
      recorder.start(1000);
      startedAtRef.current = Date.now();
      setState('recording');

      // The timer is display only. Nothing here stops the recording — only the
      // person pressing stop does.
      tickRef.current = window.setInterval(
        () => setElapsedMs(Date.now() - startedAtRef.current),
        200,
      );
    })();
  }, [release, state, watchLevel]);

  const stop = useCallback(() => {
    intentRef.current = 'finish';
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      return;
    }
    // Nothing to stop — most likely a permission prompt that is still up.
    release();
    setState('idle');
  }, [release]);

  const cancel = useCallback(() => {
    intentRef.current = 'cancel';
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      return;
    }
    release();
    setState('idle');
  }, [release]);

  const discard = useCallback(() => {
    setClip(current => {
      if (current) {
        URL.revokeObjectURL(current.url);
      }
      return null;
    });
    setElapsedMs(0);
    setState('idle');
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return {
    state,
    elapsedMs,
    clip,
    error,
    level,
    start,
    stop,
    cancel,
    discard,
    dismissError,
  };
};

export default useRecorder;
