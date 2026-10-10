/**
 * GET /api/file?id=... — streams a stored file, and serves byte ranges.
 *
 * ZentraGrid serves files to nobody without the key, so `<img>` / `<audio>` /
 * `<video>` can never point at the store directly. This route is the only way a
 * file reaches the browser, and it stays private: no shared caches, no public
 * URL.
 *
 * ## Why this route does its own ranging
 *
 * The store advertises `Accept-Ranges: bytes` but **ignores** a `Range` header —
 * it answers `200` with the whole file every time. That is fine for a picture
 * and fatal for a recording: Safari refuses to play media from a source that
 * cannot be ranged, and Chrome cannot seek without one. So the store is asked
 * for a range first (in case it ever honours it, in which case the `206` is
 * passed straight through), and when it comes back whole the slice is cut here.
 *
 * Cutting is streaming, not buffering: the prefix is read and dropped, at most
 * `count` bytes are forwarded, and the upstream body is cancelled as soon as the
 * range is complete. A seek therefore costs one upstream read, and memory stays
 * the size of one chunk rather than the size of the file.
 */

import type {NextRequest} from 'next/server';
import {parseRange} from '@/lib/media';
import {downloadFile, toErrorResponse} from '@/lib/zentra';

export const dynamic = 'force-dynamic';

/**
 * Forwards `count` bytes of `body`, starting `start` bytes in, then cancels the
 * rest. Reading and discarding the prefix is the price of a store that will not
 * range for us.
 */
const sliceStream = (
  body: ReadableStream<Uint8Array>,
  start: number,
  count: number,
): ReadableStream<Uint8Array> => {
  const reader = body.getReader();
  let skipped = 0;
  let sent = 0;

  const finish = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    controller.close();
    void reader.cancel().catch(() => {});
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const {done, value} = await reader.read();
      if (done) {
        finish(controller);
        return;
      }
      let chunk: Uint8Array = value;
      if (skipped < start) {
        const drop = Math.min(start - skipped, chunk.byteLength);
        skipped += drop;
        chunk = chunk.subarray(drop);
        // The whole chunk was prefix — ask for the next one.
        if (!chunk.byteLength) {
          return;
        }
      }
      const room = count - sent;
      if (chunk.byteLength >= room) {
        controller.enqueue(chunk.subarray(0, room));
        sent += room;
        finish(controller);
        return;
      }
      controller.enqueue(chunk);
      sent += chunk.byteLength;
    },
    cancel(reason) {
      void reader.cancel(reason).catch(() => {});
    },
  });
};

export const GET = async (request: NextRequest) => {
  try {
    const id = (request.nextUrl.searchParams.get('id') || '').trim();
    if (!id) {
      return Response.json({error: 'An id is required'}, {status: 400});
    }

    const range = request.headers.get('range');
    const upstream = await downloadFile(id, range);

    const contentType =
      upstream.headers.get('content-type') || 'application/octet-stream';
    const total = Number(upstream.headers.get('content-length') || 0);
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    // Private, and never stored by a shared cache: this is somebody's own
    // screenshot, voice note or screen recording.
    headers.set('Cache-Control', 'private, max-age=3600');
    headers.set('Accept-Ranges', 'bytes');

    // The store honoured the range — hand its answer straight back.
    if (upstream.status === 206 && upstream.body) {
      headers.set('Content-Range', upstream.headers.get('content-range') || '');
      if (total) {
        headers.set('Content-Length', String(total));
      }
      return new Response(upstream.body, {status: 206, headers});
    }

    // Nothing to slice: no range asked for, or no length to slice against.
    if (!range || !total || !upstream.body) {
      if (total) {
        headers.set('Content-Length', String(total));
      }
      return new Response(upstream.body, {status: 200, headers});
    }

    const wanted = parseRange(range, total);
    if (wanted === null) {
      // A malformed Range is meant to be ignored, not refused — but it is
      // clearer here to fall back to the whole file deliberately.
      headers.set('Content-Length', String(total));
      return new Response(upstream.body, {status: 200, headers});
    }
    if (wanted === 'unsatisfiable') {
      void upstream.body.cancel().catch(() => {});
      headers.set('Content-Range', `bytes */${total}`);
      return Response.json(
        {error: 'That byte range is past the end of the file', code: 'RANGE'},
        {status: 416, headers},
      );
    }

    const count = wanted.end - wanted.start + 1;
    headers.set('Content-Range', `bytes ${wanted.start}-${wanted.end}/${total}`);
    headers.set('Content-Length', String(count));
    return new Response(sliceStream(upstream.body, wanted.start, count), {
      status: 206,
      headers,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
};
