/**
 * GET  /api/presence — the users who have the app open right now, plus the
 *                      panel members who are around.
 * POST /api/presence — the panel's own heartbeat.
 *
 * "Online" means one thing only: the account's last heartbeat is inside the
 * 60-second window. A phone that was killed ages out on its own, so there are no
 * ghost entries to clean up.
 */

import {ONLINE_WINDOW_MS} from '@/lib/contract';
import {announcePanel, listOnline, panelHandle} from '@/lib/server/presence';
import {toErrorResponse} from '@/lib/zentra';

export const dynamic = 'force-dynamic';

export const GET = async () => {
  try {
    const [users, panel] = await Promise.all([
      listOnline('user'),
      listOnline('panel'),
    ]);
    return Response.json({
      users,
      panel,
      onlineCount: users.length,
      windowMs: ONLINE_WINDOW_MS,
      panelHandle: panelHandle(),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
};

// The body is deliberately ignored: a heartbeat is "I am here", nothing more.
export const POST = async () => {
  try {
    const beat = await announcePanel();
    return Response.json(beat);
  } catch (error) {
    return toErrorResponse(error);
  }
};
