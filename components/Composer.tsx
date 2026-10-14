'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {deleteUploadedFile, uploadMedia} from '@/lib/api';
import {
  MediaKind,
  type SentAttachment,
  kindFromMime,
} from '@/lib/contract';
import {fileSize} from '@/lib/format';
import {formatClip, formatTimer, recordingSupport} from '@/lib/media';
import useRecorder from '@/hooks/useRecorder';
import {
  CloseIcon,
  ExpandIcon,
  MicIcon,
  PlusIcon,
  SendIcon,
  StopIcon,
} from './icons';

/**
 * The box a reply is written in, and the place a voice note is recorded. Shared
 * by a thread and by Broadcast, because both write the same kind of document and
 * both deserve the same rules:
 *
 * - **one + button, every kind of file.** The dialog opens on the gallery and
 *   accepts pictures and recordings together, so a mixed send — twelve
 *   screenshots and the screen recording that goes with them — is one gesture
 *   rather than twelve. Everything picked waits in one strip and goes up
 *   together.
 * - **no ceilings.** No cap on how many files ride along, no cap on how long a
 *   message is, no cap on how long a voice note runs. This is the console, not
 *   the phone: the long explanation, the log dump and the twenty screenshots are
 *   the normal case. The only refusal on weight comes from the store, in its own
 *   words.
 * - **nothing uploads until Send is pressed.** Files picked and then thrown away
 *   leave nothing behind in the store, and a recording abandoned mid-thought
 *   costs exactly nothing.
 * - **a send that dies halfway is not a send that died.** The files go up first,
 *   then the caller writes one message per file and says how many landed; any
 *   upload no message points at is deleted again. The words — and every file the
 *   caller refused — stay in the box, because losing a half-written answer to a
 *   dropped connection is the one thing that makes an internal tool infuriating.
 * - ⌘/Ctrl + Enter sends; Enter alone is a newline, as it should be in a box that
 *   people paste stack traces into.
 *
 * A voice note is recorded here (MediaRecorder over the microphone), so the mic
 * button only appears where that is actually possible: an https origin or
 * localhost. Everything else is a file — a screen recording is made by the
 * operating system, and there is no reason to ask for a webcam to discuss a
 * playback bug.
 */

type Pending = {
  /** A local key: the file has no id yet, and two photos can share a name. */
  key: string;
  kind: MediaKind;
  file: File;
  /** Object URL of the local file, so the preview is the actual thing. */
  preview: string;
  /** Only a recording knows this before it is uploaded. */
  durationMs: number | null;
  bytes: number;
};

type ComposerProps = {
  placeholder: string;
  /**
   * Sends everything the person put together and resolves with **how many files
   * the store really took**. Throw to say nothing landed: every upload is then
   * taken back out again.
   */
  onSend: (text: string, attachments: SentAttachment[]) => Promise<number>;
  onError: (message: string) => void;
  /**
   * The box was typed in — the empty string means it was emptied. The screen
   * turns this into the "typing…" the app reads; the composer itself only
   * reports, so where that goes stays the screen's business.
   */
  onTyping?: (draft: string) => void;
  disabled?: boolean;
  /** Broadcast needs a louder button than a reply does. */
  sendLabel?: string;
};

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'm4v', '3gp', 'avi'];
const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'heic',
  'heif',
  'bmp',
  'avif',
];

const extensionOf = (name: string): string =>
  (name || '').split('.').pop()?.toLowerCase() || '';

/**
 * What a picked file is.
 *
 * The mime is trusted first. When the browser sends none — which a gallery on
 * some phones does — the extension decides, and a file with neither is treated
 * as a picture, because that is what a media picker hands over. A file that
 * declares itself as neither (a PDF, a zip) returns null and is refused.
 */
const kindOfFile = (file: File): MediaKind | null => {
  const fromMime = kindFromMime(file.type || '');
  if (fromMime) {
    return fromMime;
  }
  const extension = extensionOf(file.name);
  if (VIDEO_EXTENSIONS.includes(extension)) {
    return 'video';
  }
  if (IMAGE_EXTENSIONS.includes(extension)) {
    return 'image';
  }
  return file.type ? null : 'image';
};

const kindName = (kind: MediaKind): string =>
  kind === 'video' ? 'Video' : kind === 'audio' ? 'Voice note' : 'Picture';

const Composer = ({
  placeholder,
  onSend,
  onError,
  onTyping,
  disabled = false,
  sendLabel,
}: ComposerProps) => {
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  /** How far the uploads have got, so twenty files are not a blind spinner. */
  const [progress, setProgress] = useState<{done: number; total: number} | null>(
    null,
  );
  const [canRecord, setCanRecord] = useState(false);
  /** A pending video the person wants to look at before sending it. */
  const [watching, setWatching] = useState<Pending | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const counter = useRef(0);
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

  /** Object URLs hold the file in memory, so they are released deliberately. */
  const release = useCallback((item: Pending) => {
    URL.revokeObjectURL(item.preview);
  }, []);

  // Leaving the screen releases whatever was still waiting — the recorder's own
  // hook does the same for the microphone.
  const live = useRef<Pending[]>([]);
  live.current = pending;
  useEffect(
    () => () => {
      live.current.forEach(item => URL.revokeObjectURL(item.preview));
    },
    [],
  );

  /** A finished recording is appended, so several notes can be sent together. */
  useEffect(() => {
    if (recorderState !== 'ready' || !clip) {
      return;
    }
    setPending(current => [
      ...current,
      {
        key: `f${(counter.current += 1)}`,
        kind: 'audio',
        file: clip.file,
        // Our own URL: the recorder's is released the moment we take the file.
        preview: URL.createObjectURL(clip.file),
        durationMs: clip.durationMs,
        bytes: clip.bytes,
      },
    ]);
    discardClip();
  }, [clip, discardClip, recorderState]);

  const pickFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) {
        return;
      }
      const accepted: Pending[] = [];
      const refused: string[] = [];
      Array.from(files).forEach(file => {
        const kind = kindOfFile(file);
        if (kind === 'audio') {
          refused.push(`${file.name} is audio — record it with the mic`);
          return;
        }
        if (!kind) {
          refused.push(`${file.name} is neither a picture nor a video`);
          return;
        }
        accepted.push({
          key: `f${(counter.current += 1)}`,
          kind,
          file,
          preview: URL.createObjectURL(file),
          durationMs: null,
          bytes: file.size,
        });
      });
      if (accepted.length) {
        setPending(current => [...current, ...accepted]);
      }
      if (refused.length) {
        onError(refused.join(' · '));
      }
    },
    [onError],
  );

  const removeAt = useCallback(
    (key: string) => {
      setPending(current => {
        const gone = current.find(item => item.key === key);
        if (gone) {
          release(gone);
        }
        return current.filter(item => item.key !== key);
      });
    },
    [release],
  );

  const clearPending = useCallback(() => {
    setPending(current => {
      current.forEach(release);
      return [];
    });
  }, [release]);

  /** Takes back every upload that no message ended up pointing at. */
  const dropOrphans = useCallback(async (orphans: SentAttachment[]) => {
    for (const orphan of orphans) {
      try {
        await deleteUploadedFile(orphan.fileId);
      } catch {
        // Nothing useful to say: the send failure is the real message.
      }
    }
  }, []);

  const send = useCallback(async () => {
    const words = text.trim();
    if (disabled || sending || (!words && !pending.length)) {
      return;
    }
    setSending(true);
    const uploaded: SentAttachment[] = [];
    try {
      // Upload first, then store the messages that point at it — the same order
      // the phone uses, so a message never claims a file that is not there. One
      // at a time, in the order they were picked: the thread will read the same
      // way it was written.
      if (pending.length) {
        setProgress({done: 0, total: pending.length});
      }
      for (const item of pending) {
        const stored = await uploadMedia(
          item.file,
          item.durationMs ?? undefined,
        );
        uploaded.push({
          fileId: stored.id,
          kind: stored.kind,
          mime: stored.mimeType || item.file.type,
          durationMs: stored.durationMs ?? item.durationMs,
          bytes: stored.size ?? item.bytes,
        });
        setProgress({done: uploaded.length, total: pending.length});
      }

      const claimed = await onSend(words, uploaded);
      // Whatever the caller did not claim belongs to no message: take it back.
      await dropOrphans(uploaded.slice(claimed));
      setText('');
      // Sent is the end of "typing…", and saying so with the send rather than
      // with the next edit is what keeps the app's header honest.
      onTyping?.('');
      clearPending();
      textRef.current?.focus();
    } catch (error) {
      // Nothing was claimed — the caller throws only when the first message
      // failed — so every upload goes back out with it.
      await dropOrphans(uploaded);
      // Everything stays put: the words, the files, the cursor.
      onError((error as Error).message || 'Could not send that');
    } finally {
      setProgress(null);
      setSending(false);
    }
  }, [
    clearPending,
    disabled,
    dropOrphans,
    onError,
    onSend,
    onTyping,
    pending,
    sending,
    text,
  ]);

  const recording = recorderState === 'recording';
  const starting = recorderState === 'starting';
  const canSend =
    (!!text.trim() || !!pending.length) && !disabled && !sending && !recording;
  const readyBytes = pending.reduce((total, item) => total + item.bytes, 0);

  return (
    // `shrink-0`: the composer is the one thing in the thread that must never be
    // squeezed out of the column, however much conversation is above it. The
    // message list is the piece that flexes (ThreadView).
    <div className="glass sheen relative shrink-0 p-3">
      {pending.length ? (
        <div className="glass-soft mb-2 p-2">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[11px] text-ink-muted">
              <span className="font-bold text-ink">
                {pending.length} {pending.length === 1 ? 'file' : 'files'}
              </span>{' '}
              ready · {fileSize(readyBytes)} · uploads when you press send
            </p>
            {pending.length > 1 ? (
              <button
                type="button"
                onClick={clearPending}
                className="focus-ring rounded-lg px-2 py-1 text-[11px] text-ink-muted transition hover:bg-white/5 hover:text-danger">
                Clear all
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {pending.map(item => (
              <div
                key={item.key}
                className="group/chip relative flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-1.5 pr-2">
                {item.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.preview}
                    alt={item.file.name}
                    className="h-11 w-11 shrink-0 rounded-lg object-cover"
                  />
                ) : item.kind === 'video' ? (
                  <button
                    type="button"
                    aria-label={`Play ${item.file.name}`}
                    onClick={() => setWatching(item)}
                    className="focus-ring relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black">
                    {/* `#t=0.1` asks the browser for a real frame rather than a
                        black box — the same trick a video thumbnail uses. */}
                    <video
                      src={`${item.preview}#t=0.1`}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                      <ExpandIcon size={13} className="text-ink" />
                    </span>
                  </button>
                ) : (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-cyan/40 bg-cyan/15">
                    <MicIcon size={16} className="text-cyan" />
                  </span>
                )}

                <div className="min-w-0 max-w-[10rem]">
                  <p className="truncate text-[11px] text-ink">
                    {item.kind === 'audio'
                      ? `Voice note · ${formatClip(item.durationMs)}`
                      : item.file.name}
                  </p>
                  <p className="text-[10px] text-ink-subtle">
                    {kindName(item.kind)} · {fileSize(item.bytes)}
                  </p>
                </div>

                {item.kind === 'audio' ? (
                  // A note has to be listenable before it is sent, or the only
                  // way to check it is to send it to a real user.
                  <audio src={item.preview} controls className="h-8 w-40" />
                ) : null}

                <button
                  type="button"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => removeAt(item.key)}
                  className="focus-ring rounded-lg p-1 text-ink-muted transition hover:bg-white/10 hover:text-danger">
                  <CloseIcon size={14} />
                </button>
              </div>
            ))}
          </div>
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
            no limit — press the square when you are done
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
            aria-label="Attach pictures or videos"
            title="Attach pictures or videos"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || sending}
            className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-violet/40 bg-violet/15 text-violet-bright transition hover:bg-violet/25 disabled:opacity-50">
            <PlusIcon size={20} />
          </button>

          {canRecord ? (
            <button
              type="button"
              aria-label="Record a voice note"
              title="Record a voice note"
              onClick={recorder.start}
              disabled={disabled || sending}
              className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan/40 bg-cyan/15 text-cyan transition hover:bg-cyan/25 disabled:opacity-40">
              <MicIcon size={18} />
            </button>
          ) : null}

          <textarea
            ref={textRef}
            value={text}
            onChange={event => {
              setText(event.target.value);
              onTyping?.(event.target.value);
            }}
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

      {/* `multiple` is the whole point: a mixed batch is one pick, and the
          accept is wide enough that the gallery shows pictures and video in the
          same list. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={event => {
          pickFiles(event.target.files);
          // Reset, so picking the same file twice still fires a change.
          event.target.value = '';
        }}
      />

      <div className="mt-1 flex items-center justify-between gap-3 px-1">
        <span className="text-[11px] text-ink-subtle">
          {sending && progress
            ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
            : canRecord
            ? '⌘/Ctrl + Enter sends · + takes pictures and video, the mic records live'
            : '⌘/Ctrl + Enter sends · + takes pictures and video'}
        </span>
        <span className="shrink-0 text-[11px] text-ink-subtle">
          {text.trim().length ? `${text.trim().length} characters · no limit` : ''}
        </span>
      </div>

      {watching ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Video"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
          onClick={() => setWatching(null)}>
          <div className="relative w-full max-w-3xl">
            <video
              src={watching.preview}
              controls
              autoPlay
              playsInline
              className="max-h-[80vh] w-full rounded-xl2 border border-white/15 bg-black"
            />
            <p className="mt-2 text-center text-xs text-ink-muted">
              {watching.file.name} · {fileSize(watching.bytes)} · not sent yet
            </p>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setWatching(null)}
              className="focus-ring absolute -right-2 -top-2 rounded-full border border-white/15 bg-base p-1.5 text-ink">
              <CloseIcon size={16} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Composer;
