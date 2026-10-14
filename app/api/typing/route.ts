/**
 * POST /api/typing  — the panel's own "I am writing in this thread" beat.
 *
 * The phone reads it off the same collection (lib/server/typing.ts explains the
 * shape), so this is the write that turns the app's header into "typing…".
 *
 * The body is a `chatId` and nothing else. There is deliberately no way to say
 * "somebody else is typing" through this route: a document is written for the
 * thread in the request and stamped `admin`, so a bug here can annoy one
 * conversation and cannot impersonate a user.
 */

import type {NextRequest} from 'next/server';
import {announceTyping, TYPING_MS} from '@/lib/server/typing';
import {toErrorResponse} from '@/lib/zentra';

export const dynamic = 'force-dynamic';

type TypingBody = {
  chatId?: string;
  /** `false` is the goodbye — sent when the box is emptied or the thread is left. */
  typing?: boolean;
};

export const POST = async (request: NextRequest) => {
  try {
    const body = (await request.json().catch(() => ({}))) as TypingBody;
    const chatId = (body.chatId || '').trim();
    if (!chatId) {
      return Response.json({error: 'A chatId is required'}, {status: 400});
    }
    await announceTyping(chatId, body.typing !== false);
    return Response.json({ok: true, windowMs: TYPING_MS});
  } catch (error) {
    return toErrorResponse(error);
  }
};
