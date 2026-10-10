/**
 * GET /api/pulse — the four numbers on the dashboard.
 *
 * Read in one place so the tiles can never disagree with the inbox: the thread
 * and unread counts come from the very same grouping the inbox uses.
 */

import {MESSAGES, Pulse, WireMessage} from '@/lib/contract';
import {loadConversations, totalsOf} from '@/lib/server/inbox';
import {listOnline} from '@/lib/server/presence';
import {MAX_PAGE_LIMIT, queryDocuments, toErrorResponse} from '@/lib/zentra';

export const dynamic = 'force-dynamic';

/**
 * One page is all the tile needs — enough to say "200+" without walking the
 * collection. It is the service's own ceiling (see MAX_PAGE_LIMIT): a larger
 * number is rejected as a validation error, which would blank the dashboard.
 */
const RECENT_LIMIT = MAX_PAGE_LIMIT;

export const GET = async () => {
  try {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const [{conversations}, recent, users] = await Promise.all([
      loadConversations(),
      queryDocuments<WireMessage>(MESSAGES, {
        where: [['sent_at', 'gt', since]],
        limit: RECENT_LIMIT,
      }),
      listOnline('user'),
    ]);

    const totals = totalsOf(conversations);
    const pulse: Pulse & {capped: boolean} = {
      threads: totals.threads,
      unread: totals.unread,
      last24h: recent.documents.length,
      online: users.length,
      capped: recent.documents.length >= RECENT_LIMIT,
    };
    return Response.json(pulse);
  } catch (error) {
    return toErrorResponse(error);
  }
};
