/**
 * POST /api/upload — multipart form, field name `file`.
 *
 * Three kinds of file are accepted, and nothing else:
 *
 * - **images** — a screenshot of whatever is broken, exactly what the phone's
 *   composer sends today;
 * - **audio** — a voice note, recorded in the panel's own composer or sent up
 *   by the app;
 * - **video** — a screen recording, which only the panel makes.
 *
 * Anything else (a PDF, a zip, an apk) is refused, because the thread is a
 * support conversation and not a file drop. **There is no size cap here** — see
 * the note on limits in lib/contract.ts — so the only refusal on weight comes
 * from the store itself, and it is passed through in its own words. The
 * recording length, when the recorder sends one, is stored with the message so a
 * player can draw the duration before it plays.
 *
 * The stored file is keyed, so its URL is useless in a browser: the message
 * carries the file id and the thread renders it through /api/file.
 *
 * DELETE /api/upload?id=... removes one again. The composer calls it when a file
 * went up but the message that was going to carry it did not, so a failed send
 * cannot leave an orphan behind.
 */

import type {NextRequest} from 'next/server';
import {MediaKind, kindFromMime, mediaLabelOf} from '@/lib/contract';
import {deleteFile, fileUrl, toErrorResponse, uploadFile} from '@/lib/zentra';

export const dynamic = 'force-dynamic';

/**
 * The kind of an upload, for the cases where the browser sends no mime at all
 * (which it does for a Blob). `webm` and `mp4` are both containers, not kinds —
 * they are listed as the audio they usually are here, and a non-empty mime
 * always wins over this table.
 */
const EXTENSIONS: Record<string, MediaKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  heic: 'image',
  webm: 'audio',
  m4a: 'audio',
  mp3: 'audio',
  ogg: 'audio',
  wav: 'audio',
  aac: 'audio',
  opus: 'audio',
  mp4: 'video',
  mov: 'video',
};

/** Milliseconds, from the recorder. Ignored when it is not a sane number. */
const durationOf = (value: FormDataEntryValue | null | undefined): number | null => {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  return Math.round(ms);
};

export const DELETE = async (request: NextRequest) => {
  try {
    const id = (request.nextUrl.searchParams.get('id') || '').trim();
    if (!id) {
      return Response.json({error: 'An id is required'}, {status: 400});
    }
    await deleteFile(id);
    return Response.json({id, deleted: true});
  } catch (error) {
    return toErrorResponse(error);
  }
};

export const POST = async (request: NextRequest) => {
  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return Response.json({error: 'Attach a file as `file`'}, {status: 400});
    }

    const extension = (file.name || '').split('.').pop()?.toLowerCase() || '';
    const kind =
      kindFromMime(file.type || '') || EXTENSIONS[extension] || null;
    if (!kind) {
      return Response.json(
        {error: 'Images, voice notes and video only — that file is none of them'},
        {status: 400},
      );
    }

    // No size check on purpose: whatever the store accepts is accepted, and
    // whatever it refuses comes back with its own explanation.
    const stored = await uploadFile(file);
    const durationMs = durationOf(form?.get('durationMs'));

    return Response.json(
      {
        id: stored.id,
        name: stored.name || file.name,
        size: stored.size ?? file.size,
        mimeType: stored.mime_type || file.type || '',
        kind,
        durationMs,
        // A message with no words says this instead, so the phone's list stays
        // readable even for a bare recording.
        label: mediaLabelOf({file_id: stored.id, media_kind: kind}),
        // The same URL the phone writes into its own messages.
        url: fileUrl(stored.id),
      },
      {status: 201},
    );
  } catch (error) {
    return toErrorResponse(error);
  }
};
