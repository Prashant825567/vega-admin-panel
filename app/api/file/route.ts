/**
 * GET /api/file?id=... — streams a stored screenshot.
 *
 * ZentraGrid serves files to nobody without the key, so `<img src>` can never
 * point at the store directly. This route is the only way an image reaches the
 * browser, and it stays private: no shared caches, no public URL.
 */

import type {NextRequest} from 'next/server';
import {downloadFile, toErrorResponse} from '@/lib/zentra';

export const dynamic = 'force-dynamic';

export const GET = async (request: NextRequest) => {
  try {
    const id = (request.nextUrl.searchParams.get('id') || '').trim();
    if (!id) {
      return Response.json({error: 'An id is required'}, {status: 400});
    }
    const upstream = await downloadFile(id);
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
        // Private, and never stored by a shared cache: this is somebody's
        // screenshot of their own app.
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
};
