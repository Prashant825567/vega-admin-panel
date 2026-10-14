/**
 * GET  /api/presence — the users who have the app open right now, plus the
 *                      panel members who are around.
 * POST /api/presence — the panel's own heartbeat (`?away=1` for the goodbye).
 *
 * "Online" is two things, and the order matters: an account that has written
 * `away` is offline *now*, and otherwise one whose last heartbeat is inside
 * `ONLINE_WINDOW_MS`. The window exists for the case nobody can announce — a
 * phone that was killed or lost its network mid-beat — so it no longer decides
 * the ordinary cases. Nothing is deleted and no ghost rows are cleaned up: a
 * stale heartbeat simply stops counting.
 */

import type {NextRequest} from 'next/server';
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
// The only thing that changes its meaning is `?away=1`, which is the panel
// saying it is on its way out — a beacon fired while the tab closes, where a
// PATCH is the one call still allowed to leave.
export const POST = async (request: NextRequest) => {
  try {
    const flag = request.nextUrl.searchParams.get('away');
    const beat = await announcePanel(flag === '1' || flag === 'true');
    return Response.json(beat);
  } catch (error) {
    return toErrorResponse(error);
  }
};
