/**
 * Recording, playing back, and slicing what was recorded.
 *
 * The browser does the recording: `MediaRecorder` over a `getUserMedia` stream
 * needs no dependency, no server and no codec of ours. What this module owns is
 * the part that is easy to get subtly wrong:
 *
 * - **which container.** Every browser supports a different set. Chrome and
 *   Firefox record WebM; Safari records MP4. The first type the browser admits
 *   to supporting wins, and the recorder is told to use exactly that, so the
 *   stored file is one a player can actually open.
 * - **what to call it.** A `Blob` has no name, and the store wants one, so the
 *   extension follows the container rather than being guessed as `.webm` for
 *   everything.
 * - **whether it is possible at all.** `getUserMedia` is absent on an insecure
 *   origin and `MediaRecorder` is absent in older Safari. The composer asks
 *   first and hides the button instead of failing when it is pressed.
 *
 * **Only the microphone is recorded here.** Video is a file the panel uploads —
 * a screen recording is made by the operating system, and asking for someone's
 * webcam to talk about a playback bug would be a strange trade. The store and
 * the player do not care which way the bytes arrived.
 *
 * `parseRange` lives here too, because /api/file has to cut byte ranges itself
 * when the store ignores `Range` (it does) and both halves should agree on what a
 * range means.
 */

/** What a `Range` header asked for, in bytes, once it has been made sane. */
export type ByteRange = {start: number; end: number};

/**
 * Reads a `Range` header.
 *
 * `bytes=start-end`, `bytes=start-` and `bytes=-suffix` are the three forms a
 * browser actually sends. Anything else is not a range and returns null; a range
 * that runs past the end of the file returns 'unsatisfiable', which is what the
 * 416 response is for.
 */
export const parseRange = (
  header: string,
  total: number,
): ByteRange | 'unsatisfiable' | null => {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim());
  if (!match || (!match[1] && !match[2])) {
    return null;
  }
  const [, rawStart, rawEnd] = match;
  if (!rawStart) {
    // "the last N bytes"
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      return 'unsatisfiable';
    }
    return {start: Math.max(0, total - suffix), end: total - 1};
  }
  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
    return 'unsatisfiable';
  }
  return {start, end: Math.min(end, total - 1)};
};

/** Candidate containers for a voice note, best first. The winner is forced. */
const AUDIO_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

/** Where a stored file is streamed from — never straight from the store. */
export const mediaSourceUrl = (fileId: string): string =>
  `/api/file?id=${encodeURIComponent(fileId)}`;

/**
 * Whether this browser can record at all.
 *
 * `getUserMedia` only exists on a secure origin, which is why the check is not
 * merely "MediaRecorder exists": localhost and https qualify, a plain-http
 * deployment does not, and the composer should hide the button rather than offer
 * one that can never work. Whether a *microphone* is actually attached is
 * deliberately not guessed at — that answer only arrives with the permission
 * prompt, and `explainMediaError` is what turns a refusal into a sentence.
 */
export const recordingSupport = (): boolean => {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
    return false;
  }
  return typeof navigator.mediaDevices?.getUserMedia === 'function';
};

/** The container to record a voice note in, or undefined to let the browser choose. */
export const pickAudioMimeType = (): string | undefined => {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return undefined;
  }
  if (typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  return AUDIO_TYPES.find(type => MediaRecorder.isTypeSupported(type));
};

/** A name for a voice note, with an extension that matches its container. */
export const recordingFileName = (mime: string): string => {
  const bare = (mime || '').split(';')[0] || '';
  const extension = bare.split('/')[1] || 'webm';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `voice-${stamp}.${extension}`;
};

/** A recording's length as a player shows it: 0:07, 1:23, 12:04. */
export const formatClip = (ms: number | null): string => {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/** The same, for the running timer while something is being recorded. */
export const formatTimer = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

/**
 * What a refused `getUserMedia` should say. The browser's own message is
 * `NotAllowedError: Permission denied`, which tells nobody anything useful.
 */
export const explainMediaError = (error: unknown): string => {
  const name = (error as {name?: string})?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The browser blocked the microphone. Allow it in the address bar and try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found on this device.';
  }
  if (name === 'NotReadableError') {
    return 'The microphone is already in use by another app or tab.';
  }
  return (error as {message?: string})?.message || 'Could not start the microphone.';
};
