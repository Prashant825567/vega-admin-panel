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
  MAX_MESSAGE_LENGTH,
  WireMessage,
  chatIdFor,
  emailOf,
  isBroadcast,
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

    const text = (body.text || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    const fileId = body.fileId?.trim() || null;
    if (!text && !fileId) {
      return Response.json(
        {error: 'Type a message or attach a screenshot'},
        {status: 400},
      );
    }

    const announcement = isBroadcast(chatId);
    const data: WireMessage = {
      chat_id: chatId,
      from: ADMIN,
      // Announcements are addressed to everyone, in one shared thread.
      to: announcement ? 'all' : emailOf(chatId),
      text: text || 'Screenshot attached',
      sent_at: new Date().toISOString(),
      // The recipient's receipt, false until they look. The app flips this on
      // the team's messages when the user opens the chat, which is what turns
      // the panel's own tick blue.
      read: false,
      image: fileId ? fileUrl(fileId) : null,
      file_id: fileId,
    };

    const stored = await createDocument<WireMessage>(MESSAGES, data);
    return Response.json(
      {id: stored.id, sent_at: data.sent_at, chatId, announcement},
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
