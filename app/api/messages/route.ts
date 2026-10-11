/**
 * POST   /api/messages — send a reply, or post an announcement.
 * DELETE /api/messages?id=... — delete one message.
 *
 * The document written here is exactly the shape the phone app reads
 * (lib/contract.ts): `from: "admin"`, `read: false`, a real ISO `sent_at`, and
 * `image`/`file_id` when a screenshot travels with it. Anything else and the app
 * would draw the reply on the wrong side of the conversation.
 */

import type {NextRequest} from 'next/server';
import {
  ADMIN,
  MESSAGES,
  MediaKind,
  WireMessage,
  chatIdFor,
  emailOf,
  isBroadcast,
  mediaLabelOf,
} from '@/lib/contract';
import {
  createDocument,
  deleteDocument,
  fileUrl,
  toErrorResponse,
  ZtError,
} from '@/lib/zentra';

export const dynamic = 'force-dynamic';

type SendBody = {
  chatId?: string;
  email?: string;
  text?: string;
  /** A file the panel already uploaded through /api/upload. */
  fileId?: string | null;
  /** What that file is. The upload route already told us; this repeats it. */
  kind?: MediaKind | null;
  mime?: string | null;
  /** How long a recording runs, for the player's duration line. */
  durationMs?: number | null;
  /** What the file weighed. */
  bytes?: number | null;
};

export const POST = async (request: NextRequest) => {
  try {
    const body = (await request.json().catch(() => ({}))) as SendBody;

    // The thread comes from a chatId; an email is accepted as a convenience so
    // the UI never has to build the id itself.
    const chatId = body.chatId?.trim() || (body.email ? chatIdFor(body.email) : '');
    if (!chatId) {
      return Response.json(
        {error: 'A chatId or an email is required'},
        {status: 400},
      );
    }

    // No length cap: the words are stored exactly as they were written. The
    // app's own composer is the only place that limits what *it* types.
    const text = (body.text || '').trim();
    const fileId = body.fileId?.trim() || null;
    if (!text && !fileId) {
      return Response.json(
        {error: 'Type a message, attach a screenshot or record one'},
        {status: 400},
      );
    }

    const kind = fileId ? body.kind || null : null;
    const announcement = isBroadcast(chatId);
    const data: WireMessage = {
      chat_id: chatId,
      from: ADMIN,
      // Announcements are addressed to everyone, in one shared thread.
      to: announcement ? 'all' : emailOf(chatId),
      // A recording usually travels without words, so the message says what it
      // is: the app's list, and the panel's own preview, read this.
      text: text || mediaLabelOf({file_id: fileId, media_kind: kind}),
      sent_at: new Date().toISOString(),
      // The recipient's receipt, false until they look. The app flips this on
      // the team's messages when the user opens the chat, which is what turns
      // the panel's own tick blue.
      read: false,
      // `image` keeps its old meaning — the download url of a picture. Anything
      // else carries only its file id, which is what a player needs.
      image: kind === 'image' && fileId ? fileUrl(fileId) : null,
      file_id: fileId,
      media_kind: kind,
      mime: fileId ? body.mime || null : null,
      media_ms: fileId && Number.isFinite(Number(body.durationMs))
        ? Math.round(Number(body.durationMs))
        : null,
      media_bytes: fileId && Number.isFinite(Number(body.bytes))
        ? Math.round(Number(body.bytes))
        : null,
    };

    const stored = await createDocument<WireMessage>(MESSAGES, data);
    return Response.json(
      {id: stored.id, sent_at: data.sent_at, chatId, announcement, kind},
      {status: 201},
    );
  } catch (error) {
    return toErrorResponse(error);
  }
};

export const DELETE = async (request: NextRequest) => {
  try {
    const id = (request.nextUrl.searchParams.get('id') || '').trim();
    if (!id) {
      return Response.json({error: 'An id is required'}, {status: 400});
    }
    await deleteDocument(MESSAGES, id);
    return Response.json({id, deleted: true});
  } catch (error) {
    if (error instanceof ZtError && error.status === 404) {
      // Already gone is the outcome the caller wanted.
      return Response.json({deleted: true});
    }
    return toErrorResponse(error);
  }
};
