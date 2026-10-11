/**
 * GET /api/inbox — every conversation, newest activity first.
 *
 * Query: `q` (search an email or the last message), `unreadOnly=1`.
 * The grouping and the unread counting both happen on the server, so the
 * browser never downloads the whole collection.
 */

import type {NextRequest} from 'next/server';
import {loadConversations} from '@/lib/server/inbox';
import {accountNames} from '@/lib/server/names';
import {toErrorResponse} from '@/lib/zentra';

export const dynamic = 'force-dynamic';

export const GET = async (request: NextRequest) => {
  try {
    const params = request.nextUrl.searchParams;
    const search = (params.get('q') || '').trim().toLowerCase();
    const unreadOnly = params.get('unreadOnly') === '1';

    const [{conversations, truncated, scanned}, names] = await Promise.all([
      loadConversations(),
      // The names come from the phone's own sign-in records (lib/server/names).
      // A failure there is not a failure of the inbox — the names are simply
      // absent and the rows fall back to the address.
      accountNames().catch(() => new Map<string, string>()),
    ]);

    const named = conversations.map(row => ({
      ...row,
      name: names.get(row.email) ?? null,
    }));

    const filtered = named.filter(row => {
      if (unreadOnly && row.unread === 0) {
        return false;
      }
      if (!search) {
        return true;
      }
      // A search matches either the name or the address, because the person
      // looking knows one of the two and not always the same one.
      return (
        row.email.includes(search) ||
        (row.name || '').toLowerCase().includes(search) ||
        row.lastText.toLowerCase().includes(search)
      );
    });

    return Response.json({conversations: filtered, truncated, scanned});
  } catch (error) {
    return toErrorResponse(error);
  }
};
