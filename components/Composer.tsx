'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {deleteUploadedFile, uploadMedia} from '@/lib/api';
import {
  MEDIA_LIMITS,
  MediaKind,
  RECORD_LIMIT_MS,
  kindFromMime,
} from '@/lib/contract';
import {fileSize} from '@/lib/format';
import {formatClip, formatTimer, recordingSupport} from '@/lib/media';
import useRecorder from '@/hooks/useRecorder';
import {
  CloseIcon,
  ImageIcon,
  MicIcon,
  SendIcon,
  StopIcon,
  VideoIcon,
} from './icons';

/**
 * The box a reply is written in, and the place a voice note is recorded. Shared
 * by a thread and by Broadcast, because both write the same kind of document and
 * both deserve the same rules:
 *
 * - sending is disabled while there is nothing to send, and while one is in
 *   flight, so a double click can never post twice;
 * - the words are kept on a failure (the caller throws and this puts them back),
 *   because losing a half-written answer to a dropped connection is the one
 *   thing that makes an internal tool infuriating;
 * - ⌘/Ctrl + Enter sends; Enter alone is a newline, as it should be in a box
 *   that people paste stack traces into;
 * - **a voice note is recorded here** (mediaRecorder over the microphone) — the
 *   mic button only appears where that is actually possible, which means an
 *   https origin or localhost;
 * - **everything else is a file.** A screenshot and a video are picked, not
 *   captured: a screen recording is made by the operating system, and there is
 *   no reason to ask for a webcam to discuss a playback bug;
 * - **nothing uploads until Send is pressed.** A file picked and then thrown
 *   away leaves nothing behind in the store, and a recording abandoned
 *   mid-thought costs exactly nothing. One path uploads all three kinds, so an
 *   image, a voice note and a video cannot drift apart — and if the upload
 *   succeeds but the message does not, the file is deleted again.
 */

/** What the caller gets back about the file that just went up. */
export type SentAttachment = {
  fileId: string;
  kind: MediaKind;
  mime: string;
  durationMs: number | null;
  bytes: number | null;
};

type Pending = {
  kind: MediaKind;
  file: File;
  /** Object URL of the local file, so the preview is the actual thing. */
  preview: string;
  /** Only a recording knows this before it is uploaded. */
  durationMs: number | null;
  bytes: number;
  /** The recorder's own length cap is what ended it, not the person's finger. */
  capped: boolean;
};

type ComposerProps = {
  placeholder: string;
  maxLength: number;
  /** Sends and resolves once the server has it; throw to keep the words. */
  onSend: (text: string, attachment: SentAttachment | null) => Promise<void>;
  onError: (message: string) => void;
  disabled?: boolean;
  /** Broadcast needs a louder button than a reply does. */
  sendLabel?: string;
};

const Composer = ({
  placeholder,
  maxLength,
  onSend,
  onError,
  disabled = false,
  sendLabel,
}: ComposerProps) => {
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [sending, setSending] = useState(false);
  const [canRecord, setCanRecord] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const recorder = useRecorder();
  const {
    state: recorderState,
    clip,
    discard: discardClip,
    error: recorderError,
    dismissError,
  } = recorder;

  // Feature detection has to wait for the browser: the server has no
  // MediaRecorder, and guessing would make the first paint disagree with the
  // second one.
  useEffect(() => setCanRecord(recordingSupport()), []);

  /** A finished recording becomes the pending attachment, once. */
  useEffect(() => {
    if (recorderState !== 'ready' || !clip) {
      return;
    }
    setPending({
      kind: 'audio',
      file: clip.file,
      // Our own URL: the recorder's is released the moment we take the file.
      preview: URL.createObjectURL(clip.file),
      durationMs: clip.durationMs,
      bytes: clip.bytes,
      // Read before `discardClip` resets the flag below.
      capped: recorder.hitLimit,
    });
    discardClip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip, discardClip, recorderState]);

  // Object URLs hold the file in memory until they are released.
  useEffect(
    () => () => {
      if (pending?.preview) {
        URL.revokeObjectURL(pending.preview);
      }
    },
    [pending],
  );

  const clearPending = useCallback(() => {
    setPending(current => {
      if (current?.preview) {
        URL.revokeObjectURL(current.preview);
      }
      return null;
    });
  }, []);

  /**
   * Opens the file dialog already filtered. The `accept` is set on the element
   * rather than in state, because state would not have re-rendered before the
   * click arrives and the dialog would open with the previous filter.
   */
  const openPicker = useCallback((accept: string) => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.accept = accept;
    input.click();
  }, []);

  const pickFile = useCallback(
    (file: File | undefined) => {
      if (!file) {
        return;
      }
      const extension = (file.name || '').split('.').pop()?.toLowerCase() || '';
      const kind =
        kindFromMime(file.type) ||
        (['mp4', 'mov', 'mkv', 'webm'].includes(extension) ? 'video' : 'image');
      if (kind === 'audio') {
        onError('Record a voice note with the mic — the attach button is for files');
        return;
      }
      if (file.size > MEDIA_LIMITS[kind]) {
        onError(
          `${kind === 'video' ? 'That video' : 'That screenshot'} is over ${Math.round(
            MEDIA_LIMITS[kind] / 1024 / 1024,
          )} MB`,
        );
        return;
      }
      setPending(current => {
        if (current?.preview) {
          URL.revokeObjectURL(current.preview);
        }
        return {
          kind,
          file,
          preview: URL.createObjectURL(file),
          durationMs: null,
          bytes: file.size,
          // An uploaded video knows its own length from its metadata; the player
          // reads it there instead of being told.
          capped: false,
        };
      });
    },
    [onError],
  );

  const send = useCallback(async () => {
    const words = text.trim();
    if (disabled || sending || (!words && !pending)) {
      return;
    }
    setSending(true);
    let uploaded: string | null = null;
    try {
      // Upload first, then store the message that points at it — the same order
      // the phone uses, so a message never claims a file that is not there.
      let attachment: SentAttachment | null = null;
      if (pending) {
        const stored = await uploadMedia(pending.file, pending.durationMs ?? undefined);
        uploaded = stored.id;
        attachment = {
          fileId: stored.id,
          kind: stored.kind,
          mime: stored.mimeType || pending.file.type,
          durationMs: stored.durationMs ?? pending.durationMs,
          bytes: stored.size ?? pending.bytes,
        };
      }
      await onSend(words, attachment);
      setText('');
      clearPending();
      textRef.current?.focus();
    } catch (error) {
      // The file went up but the message did not: take the file back out, so an
      // abandoned send does not leave bytes nothing can ever reference.
      if (uploaded) {
        try {
          await deleteUploadedFile(uploaded);
        } catch {
          // Nothing useful to say: the send failure is the real message.
        }
      }
      // Everything stays put — the words, the recording, the cursor.
      onError((error as Error).message || 'Could not send that');
    } finally {
      setSending(false);
    }
  }, [clearPending, disabled, onError, onSend, pending, sending, text]);

  const recording = recorderState === 'recording';
  const starting = recorderState === 'starting';
  const canSend =
    (!!text.trim() || !!pending) && !disabled && !sending && !recording;
  const nearlyFull = text.length > maxLength - 60;

  return (
    <div className="glass sheen relative p-3">
      {pending ? (
        <div className="glass-soft mb-2 flex items-center gap-3 p-2">
          {pending.kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pending.preview}
              alt={pending.file.name}
              className="h-11 w-11 rounded-lg object-cover"
            />
          ) : pending.kind === 'video' ? (
            <video
              src={pending.preview}
              controls
              playsInline
              className="h-16 w-28 shrink-0 rounded-lg border border-white/10 bg-black object-contain"
            />
          ) : (
            <audio
              src={pending.preview}
              controls
              className="h-9 w-44 shrink-0"
            />
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-ink">
              {pending.kind === 'audio'
                ? `Voice note · ${formatClip(pending.durationMs)}`
                : pending.kind === 'video'
                ? `Video · ${pending.file.name}`
                : pending.file.name}
            </p>
            <p className="text-[11px] text-ink-muted">
              {fileSize(pending.bytes)} · uploads when you press send
              {pending.capped ? ` · stopped at the ${formatClip(RECORD_LIMIT_MS)} limit` : ''}
            </p>
          </div>

          <button
            type="button"
            aria-label="Throw this away"
            onClick={clearPending}
            className="focus-ring rounded-lg p-1.5 text-ink-muted hover:bg-white/5 hover:text-ink">
            <CloseIcon size={16} />
          </button>
        </div>
      ) : null}

      {recorderError ? (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2">
          <p className="flex-1 text-xs text-danger">{recorderError}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismissError}
            className="focus-ring rounded p-0.5 text-danger/80 hover:text-danger">
            <CloseIcon size={14} />
          </button>
        </div>
      ) : null}

      {recording || starting ? (
        <div className="flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full bg-danger ${
              recording ? 'animate-pulse' : ''
            }`}
          />
          <span className="min-w-[3.4rem] text-sm font-semibold tabular-nums text-ink">
            {formatTimer(recorder.elapsedMs)}
          </span>

          <span
            aria-label="Microphone level"
            className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
            {/* A real meter, not a decoration: the width is the loudest moment of
                the last fraction of a second, measured off the stream. */}
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-violet-bright/80 transition-[width] duration-100 ease-out"
              style={{width: `${Math.round(recorder.level * 100)}%`}}
            />
          </span>

          <span className="shrink-0 text-[11px] text-ink-subtle">
            / {formatClip(RECORD_LIMIT_MS)}
          </span>

          <button
            type="button"
            aria-label="Throw this recording away"
            onClick={recorder.cancel}
            className="focus-ring shrink-0 rounded-xl border border-white/10 bg-white/5 p-2 text-ink-muted transition hover:text-danger">
            <CloseIcon size={16} />
          </button>
          <button
            type="button"
            aria-label="Stop recording"
            disabled={starting}
            onClick={recorder.stop}
            className="focus-ring flex h-11 min-w-[52px] shrink-0 items-center justify-center rounded-xl border border-violet-bright/60 bg-gradient-to-b from-violet to-violet-deep text-white shadow-glow transition disabled:opacity-50">
            <StopIcon size={17} />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <button
            type="button"
            aria-label="Attach a screenshot"
            title="Attach a screenshot"
            onClick={() => openPicker('image/*')}
            disabled={disabled || sending}
            className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-violet/40 bg-violet/15 text-violet-bright transition hover:bg-violet/25 disabled:opacity-50">
            <ImageIcon size={18} />
          </button>

          <button
            type="button"
            aria-label="Attach a video"
            title="Attach a video"
            onClick={() => openPicker('video/*')}
            disabled={disabled || sending}
            className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-violet/40 bg-violet/15 text-violet-bright transition hover:bg-violet/25 disabled:opacity-50">
            <VideoIcon size={18} />
          </button>

          {canRecord ? (
            <button
              type="button"
              aria-label="Record a voice note"
              title="Record a voice note"
              onClick={recorder.start}
              disabled={disabled || sending || !!pending}
              className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan/40 bg-cyan/15 text-cyan transition hover:bg-cyan/25 disabled:opacity-40">
              <MicIcon size={18} />
            </button>
          ) : null}

          <textarea
            ref={textRef}
            value={text}
            onChange={event => setText(event.target.value.slice(0, maxLength))}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder={placeholder}
            disabled={disabled}
            className="scroll-thin max-h-40 min-h-[42px] flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-violet-bright/50"
          />

          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            aria-label={sendLabel || 'Send reply'}
            className={`focus-ring flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${
              canSend
                ? 'border border-violet-bright/60 bg-gradient-to-b from-violet to-violet-deep text-white shadow-glow'
                : 'cursor-not-allowed border border-white/10 bg-white/5 text-ink-subtle'
            }`}>
            {sending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <SendIcon size={17} />
            )}
            {sendLabel ? <span className="hidden sm:inline">{sendLabel}</span> : null}
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={event => {
          pickFile(event.target.files?.[0]);
          // Reset, so picking the same file twice still fires a change.
          event.target.value = '';
        }}
      />

      <div className="mt-1 flex items-center justify-between px-1">
        <span className="text-[11px] text-ink-subtle">
          {canRecord
            ? '⌘/Ctrl + Enter sends · the mic records live, the rest are files'
            : '⌘/Ctrl + Enter sends'}
        </span>
        {nearlyFull ? (
          <span
            className={`text-[11px] ${text.length >= maxLength ? 'text-danger' : 'text-ink-muted'}`}>
            {text.length}/{maxLength}
          </span>
        ) : null}
      </div>
    </div>
  );
};

export default Composer;
