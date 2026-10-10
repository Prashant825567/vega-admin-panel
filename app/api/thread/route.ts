/**
 * GET /api/thread?chatId=... — one conversation, oldest message first.
 *
 * Every message carries its own `read` flag, because that is the receipt the
 * app paints: on a message the user wrote, `read: true` means the team has
 * opened it (the app shows blue double ticks), and on an admin reply it means
 * the user has. The thread screen reads both.
 */

import type {NextRequest} from 'next/server';
import {
  MESSAGES,
  MAX_MESSAGE_LENGTH,
  SCAN_LIMIT,
  ThreadMessage,
  WireMessage,
  atOf,
  emailOf,
} from '@/lib/contract';
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
      .map(doc => {
        const wire = doc.data || {};
        const at = atOf(wire) || Date.parse(doc.created_at || '') || 0;
        const text = (wire.text || '').trim();
        const fileId = wire.file_id || null;
        return {
          id: doc.id,
          from:
            (wire.from || '').trim().toLowerCase() === 'admin'
              ? ('team' as const)
              : ('user' as const),
          text: text || (fileId ? 'Screenshot attached' : ''),
          fileId,
          at,
          read: wire.read === true,
        };
      })
      // A document with neither words nor a screenshot has nothing to show.
      .filter(message => message.text || message.fileId);

    return Response.json({
      chatId,
      email: emailOf(chatId),
      messages,
      truncated,
      maxLength: MAX_MESSAGE_LENGTH,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
};
