/**
 * GET /api/users — the roster: every account the app has checked in for.
 *
 * Read straight off the `presence` collection, because that is the only list of
 * accounts this panel can see. The phone writes one heartbeat document per
 * account and keeps rewriting it, so each document is both "this account exists"
 * and "this is when it was last here" — which is exactly the two columns the
 * Users screen draws.
 *
 * The live screen answers "who is here right now"; this one answers "who is
 * there at all", so nothing is filtered by time.
 */

import {listKnownUsers} from '@/lib/server/presence';
import {toErrorResponse} from '@/lib/zentra';

export const dynamic = 'force-dynamic';

export const GET = async () => {
  try {
    const {users, truncated} = await listKnownUsers();
    return Response.json({
      users,
      total: users.length,
      /** The walk hit its ceiling, so the oldest accounts may be missing. */
      truncated,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
};
