/**
 * GET /api/thread?chatId=... — one conversation, oldest message first.
 *
 * Every message carries its own `read` flag, because that is the receipt the
 * app paints: on a message the user wrote, `read: true` means the team has
 * opened it (the app shows blue double ticks), and on an admin reply it means
 * the user has. The thread screen reads both.
 *
 * Messages the team has hidden from its own side are left out here and nowhere
 * else: the documents are untouched, so the person who wrote them still has them
 * and every other screen that reads them — the phone's own chat included — still
 * sees them. That is what makes "delete for me" different from "delete for
 * everyone", and it is the only difference.
 */

import type {NextRequest} from 'next/server';
import {
  MESSAGES,
  SCAN_LIMIT,
  MEDIA_LABEL,
  ThreadMessage,
  WireMessage,
  atOf,
  emailOf,
  isHiddenForTeam,
  mediaKindOf,
} from '@/lib/contract';
import {nameOf} from '@/lib/server/names';
import {isUserTyping} from '@/lib/server/typing';
import {queryAll, toErrorResponse} from '@/lib/zentra';

export const dynamic = 'force-dynamic';

export const GET = async (request: NextRequest) => {
  try {
    const chatId = (request.nextUrl.searchParams.get('chatId') || '').trim();
    if (!chatId) {
      return Response.json({error: 'chatId is required'}, {status: 400});
    }

    const {documents, truncated} = await queryAll<WireMessage>(
      MESSAGES,
      {
        where: [['chat_id', 'eq', chatId]],
        orderBy: 'sent_at',
        limit: 200,
      },
      SCAN_LIMIT,
    );

    const messages: ThreadMessage[] = documents
      .filter(doc => !isHiddenForTeam(doc.data || {}))
      .map(doc => {
        const wire = doc.data || {};
        const at = atOf(wire) || Date.parse(doc.created_at || '') || 0;
        const text = (wire.text || '').trim();
        const fileId = wire.file_id || null;
        const media = mediaKindOf(wire);
        const durationMs = Number(wire.media_ms);
        const bytes = Number(wire.media_bytes);
        return {
          id: doc.id,
          from:
            (wire.from || '').trim().toLowerCase() === 'admin'
              ? ('team' as const)
              : ('user' as const),
          // A recording often has no words, so the bubble needs something to
          // say even before the player draws itself.
          text: text || (media ? MEDIA_LABEL[media] : ''),
          fileId,
          media,
          mime: wire.mime || null,
          durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null,
          bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : null,
          at,
          read: wire.read === true,
        };
      })
      // A document with neither words nor a screenshot has nothing to show.
      .filter(message => message.text || message.fileId);

    const email = emailOf(chatId);
    // The header shows the name they signed in with; a Firestore hiccup must not
    // take the thread down with it, so a failure here just means the screen
    // falls back to the address.
    const name = await nameOf(email).catch(() => null);
    // "typing…" rides the thread's own poll rather than a clock of its own: it is
    // stale the moment it is read, and two requests for one screen is one too
    // many. A store that cannot answer is simply not typing.
    const typing = await isUserTyping(chatId);

    return Response.json({
      chatId,
      email,
      name,
      messages,
      typing,
      truncated,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
};
