/**
 * POST /api/upload — multipart form, field name `file`.
 *
 * Screenshots only, on purpose: the panel exists to answer about the app, and
 * the phone's composer is image-only too. The stored file is keyed, so its URL
 * is useless in a browser — the message carries the file id and the thread
 * renders it through /api/file.
 */

import type {NextRequest} from 'next/server';
import {fileUrl, toErrorResponse, uploadFile} from '@/lib/zentra';

export const dynamic = 'force-dynamic';

/** The store takes bigger, but a support screenshot never needs to be. */
const MAX_BYTES = 10 * 1024 * 1024;

export const POST = async (request: NextRequest) => {
  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return Response.json({error: 'Attach a file as `file`'}, {status: 400});
    }
    if (file.type && !file.type.startsWith('image/')) {
      return Response.json({error: 'Images only'}, {status: 400});
    }
    if (file.size > MAX_BYTES) {
      return Response.json({error: 'That screenshot is over 10 MB'}, {status: 400});
    }

    const stored = await uploadFile(file);
    return Response.json(
      {
        id: stored.id,
        name: stored.name || file.name,
        size: stored.size ?? file.size,
        mimeType: stored.mime_type || file.type,
        // The same URL the phone writes into its own messages.
        url: fileUrl(stored.id),
      },
      {status: 201},
    );
  } catch (error) {
    return toErrorResponse(error);
  }
};
