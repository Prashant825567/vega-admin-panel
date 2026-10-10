/**
 * GET /api/inbox — every conversation, newest activity first.
 *
 * Query: `q` (search an email or the last message), `unreadOnly=1`.
 * The grouping and the unread counting both happen on the server, so the
 * browser never downloads the whole collection.
 */

import type {NextRequest} from 'next/server';
import {loadConversations} from '@/lib/server/inbox';
import {toErrorResponse} from '@/lib/zentra';

export const dynamic = 'force-dynamic';

export const GET = async (request: NextRequest) => {
  try {
    const params = request.nextUrl.searchParams;
    const search = (params.get('q') || '').trim().toLowerCase();
    const unreadOnly = params.get('unreadOnly') === '1';

    const {conversations, truncated, scanned} = await loadConversations();

    const filtered = conversations.filter(row => {
      if (unreadOnly && row.unread === 0) {
        return false;
      }
      if (!search) {
        return true;
      }
      return (
        row.email.includes(search) || row.lastText.toLowerCase().includes(search)
      );
    });

    return Response.json({conversations: filtered, truncated, scanned});
  } catch (error) {
    return toErrorResponse(error);
  }
};
