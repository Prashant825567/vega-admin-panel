/**
 * POST /api/read — mark the user's messages as opened.
 *
 * This is the panel's half of the app's blue double tick: a message the user
 * wrote, with `read: true`, is drawn in the app as "seen by the team". The
 * screen calls this when a thread is opened, and again on every poll while it
 * stays open, so a new message that arrives while the team is reading it is
 * acknowledged too.
 *
 * Announcements are refused on purpose. `chat_broadcast` is ONE shared document,
 * so marking it read would claim every other user had read it as well — there is
 * no per-user receipt to write there.
 */

import type {NextRequest} from 'next/server';
import {BROADCAST_CHAT, MESSAGES} from '@/lib/contract';
import {toErrorResponse, updateDocument} from '@/lib/zentra';

export const dynamic = 'force-dynamic';

/** One request cannot ask for more than this, so a bug cannot run away. */
const MAX_IDS = 60;

type ReadBody = {
  chatId?: string;
  ids?: string[];
};

export const POST = async (request: NextRequest) => {
  try {
    const body = (await request.json().catch(() => ({}))) as ReadBody;
    const chatId = (body.chatId || '').trim();
    const ids = Array.isArray(body.ids)
      ? body.ids
          .filter((id): id is string => typeof id === 'string' && !!id.trim())
          .slice(0, MAX_IDS)
      : [];

    if (chatId === BROADCAST_CHAT) {
      return Response.json(
        {
          error:
            'Announcements have no per-user receipt — never mark a broadcast read',
        },
        {status: 400},
      );
    }
    if (!chatId || !ids.length) {
      return Response.json({marked: 0, failed: 0});
    }

    const results = await Promise.allSettled(
      ids.map(id => updateDocument(MESSAGES, id, {read: true})),
    );
    const marked = results.filter(r => r.status === 'fulfilled').length;
    return Response.json({marked, failed: ids.length - marked});
  } catch (error) {
    return toErrorResponse(error);
  }
};
