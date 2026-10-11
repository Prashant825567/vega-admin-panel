/**
 * POST   /api/messages — send a reply, or post an announcement.
 * PATCH  /api/messages?id=... — hide messages from the team's own side.
 * DELETE /api/messages?id=... — delete one message, for everybody.
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
  updateDocument,
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

/**
 * The other half of a delete: **hide**, rather than remove.
 *
 * This is what the panel's "delete for me" writes, and the name is deliberately
 * about who it hides from. The document stays exactly as it is, so the person
 * who wrote it still has it, the phone still draws it, and the only screen that
 * stops showing it is ours. `hidden_for_team: false` puts it back, which is what
 * makes the choice reversible — a real delete never is.
 *
 * It sets the flag on every id it is given, so a future multi-select needs no
 * change here, and it reports how many took: one refusal must not look like a
 * success, and it must not stop the rest of the batch either.
 */
type HideBody = {
  id?: string;
  ids?: string[];
  /** False puts hidden messages back in the team's view. Defaults to hiding. */
  hiddenForTeam?: boolean;
};

export const PATCH = async (request: NextRequest) => {
  try {
    const body = (await request.json().catch(() => ({}))) as HideBody;
    const wanted = [
      body.id || '',
      ...(Array.isArray(body.ids) ? body.ids : []),
      request.nextUrl.searchParams.get('id') || '',
    ]
      .map(value => (value || '').trim())
      .filter(Boolean);
    const ids = [...new Set(wanted)];
    if (!ids.length) {
      return Response.json({error: 'An id is required'}, {status: 400});
    }

    const hiddenForTeam = body.hiddenForTeam !== false;
    let hidden = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await updateDocument<{hidden_for_team: boolean}>(MESSAGES, id, {
          hidden_for_team: hiddenForTeam,
        });
        hidden += 1;
      } catch {
        failed += 1;
      }
    }
    return Response.json({hidden, failed, hiddenForTeam});
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
