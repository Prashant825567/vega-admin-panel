'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import type {MediaKind} from '@/lib/contract';
import {fileSize} from '@/lib/format';
import {formatClip, mediaSourceUrl} from '@/lib/media';
import {CloseIcon, ExpandIcon, PauseIcon, PlayIcon} from './icons';

/**
 * Playing back what was recorded, inside the bubble it arrived in.
 *
 * **Audio.** A voice note is a row, not a widget: a round play button, a bar you
 * can drag, and the time either side of it. Only one note plays at a time — a
 * module-level registry pauses whatever was playing when another starts, which
 * is the one behaviour every messenger has and a naive `<audio>` tag does not.
 *
 * **Video.** Native controls, because the browser's own fullscreen, picture-in-
 * picture and keyboard shortcuts are better than anything worth rebuilding here.
 * What this adds is the frame in the bubble (so a video does not swallow the
 * thread) and a click that opens it large.
 *
 * Both stream through `/api/file`, never the store: the store serves nothing
 * without the key. A file that will not play says so and offers to open it on its
 * own, rather than showing a dead control.
 */

/** The note that is playing right now, so starting another one stops it. */
let playing: HTMLAudioElement | null = null;

type MediaPlayerProps = {
  kind: Exclude<MediaKind, 'image'>;
  fileId: string;
  /** The recorder's own measurement, so the length shows before any download. */
  durationMs?: number | null;
  /** What the file weighed, for the honest line under the player. */
  bytes?: number | null;
  className?: string;
};

const MediaPlayer = ({
  kind,
  fileId,
  durationMs,
  bytes,
  className,
}: MediaPlayerProps) => {
  const src = mediaSourceUrl(fileId);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState((durationMs || 0) / 1000);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Leaving the screen must not leave a voice note talking to an empty room.
  useEffect(
    () => () => {
      const element = audioRef.current;
      if (element) {
        element.pause();
        if (playing === element) {
          playing = null;
        }
      }
    },
    [],
  );

  const toggle = useCallback(() => {
    const element = audioRef.current;
    if (!element) {
      return;
    }
    if (element.paused) {
      if (playing && playing !== element) {
        playing.pause();
      }
      playing = element;
      void element.play().catch(() => setFailed(true));
    } else {
      element.pause();
    }
  }, []);

  if (kind === 'video') {
    return (
      <div className={className}>
        <div className="group/video relative overflow-hidden rounded-lg border border-white/10 bg-black/60">
          { }
          <video
            src={src}
            controls
            playsInline
            preload="metadata"
            className="block max-h-72 w-full bg-black object-contain"
            onError={() => setFailed(true)}
          />
          <button
            type="button"
            aria-label="Open this video large"
            onClick={() => setExpanded(true)}
            className="focus-ring absolute right-2 top-2 rounded-lg border border-white/15 bg-black/60 p-1.5 text-ink opacity-0 transition group-hover/video:opacity-100">
            <ExpandIcon size={15} />
          </button>
        </div>
        {failed ? <FailedLine src={src} /> : null}
        <p className="mt-1 text-[10px] text-ink-subtle">
          🎥 Video
          {bytes ? ` · ${fileSize(bytes)}` : ''}
        </p>

        {expanded ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Video"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
            onClick={() => setExpanded(false)}>
            <div
              className="relative w-full max-w-5xl"
              onClick={event => event.stopPropagation()}>
              { }
              <video
                src={src}
                controls
                autoPlay
                playsInline
                className="max-h-[85vh] w-full rounded-xl2 border border-white/15 bg-black"
              />
              <button
                type="button"
                aria-label="Close"
                onClick={() => setExpanded(false)}
                className="focus-ring absolute -right-2 -top-2 rounded-full border border-white/15 bg-base p-1.5 text-ink">
                <CloseIcon size={16} />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // A note that is playing (or has been scrubbed) shows how far in it is; one
  // that has not started shows how long it runs. That is what WhatsApp does.
  const clock = (isPlaying || position > 0 ? position : length) * 1000;

  return (
    <div className={className}>
      <div className="flex w-full min-w-[210px] items-center gap-2 sm:min-w-[260px]">
        <button
          type="button"
          onClick={toggle}
          aria-label={isPlaying ? 'Pause voice note' : 'Play voice note'}
          className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-violet-bright/50 bg-violet/25 text-violet-bright transition hover:bg-violet/40">
          {isPlaying ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
        </button>

        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={0}
            max={Math.max(length, 0.1)}
            step={0.05}
            value={Math.min(position, length || 0)}
            aria-label="Voice note position"
            onChange={event => {
              const element = audioRef.current;
              if (element) {
                element.currentTime = Number(event.target.value);
              }
              setPosition(Number(event.target.value));
            }}
            className="focus-ring h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-violet-bright"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[10px] tabular-nums text-ink-muted">
              {formatClip(clock)}
            </span>
            <span className="text-[10px] tabular-nums text-ink-subtle">
              {formatClip(length * 1000)}
            </span>
          </div>
        </div>
      </div>

      { }
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setPosition(0);
          if (playing === audioRef.current) {
            playing = null;
          }
        }}
        onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
        onLoadedMetadata={event => {
          const reported = event.currentTarget.duration;
          if (Number.isFinite(reported) && reported > 0) {
            setLength(reported);
          }
        }}
        onError={() => setFailed(true)}
      />

      {failed ? <FailedLine src={src} /> : null}
      <p className="mt-1 text-[10px] text-ink-subtle">
        🎤 Voice note
        {bytes ? ` · ${fileSize(bytes)}` : ''}
      </p>
    </div>
  );
};

/** What a file that will not play says, instead of a control that does nothing. */
const FailedLine = ({src}: {src: string}) => (
  <p className="mt-1 text-[10px] text-danger">
    This file would not play.{' '}
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-dotted">
      Open it on its own
    </a>
    .
  </p>
);

export default MediaPlayer;
