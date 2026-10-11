/**
 * GET /api/users — the roster: every account that has signed in, once each.
 *
 * Three sources, because no one of them is the list the screen promises:
 *
 * - **Firestore `users`** (lib/server/firestore) — the app writes a document the
 *   first time somebody claims a name, so this is the closest thing to a sign-up
 *   list that exists, and it is where a real **name** comes from. It is what puts
 *   an account on the roster that has signed in but has never written to the
 *   team, which is exactly the case this screen is meant to cover;
 * - the **presence** collection — the heartbeat, which is the only source for
 *   "in the app now", for the device, and for an account Firestore has no record
 *   of (an older build, or a sign-in that never finished);
 * - the **messages** collection, grouped the way the inbox groups it — so every
 *   row can say how much has been said, and an account we have a conversation
 *   with is never missing.
 *
 * A roster is the one screen where a duplicate is fatal to trust, so the rows are
 * keyed by email and **merged**, never concatenated. That is also what fixes the
 * duplicate rows this screen used to show: the store has no upsert, so a phone
 * whose lookup missed wrote a second heartbeat document for the same account, and
 * two documents became two rows. Folding by email makes the second document
 * irrelevant — the freshest heartbeat wins and the extra is dropped.
 *
 * The panel reads ZentraGrid and this one Firestore collection, and nothing else:
 * a full list of *every* registered account would also need Firebase Auth, which
 * this panel has no credentials for, so the screen says what it does have instead
 * of implying it has everybody.
 */

import {ONLINE_WINDOW_MS, chatIdFor} from '@/lib/contract';
import type {KnownUser} from '@/lib/contract';
import {firestoreAccounts} from '@/lib/server/firestore';
import {loadConversations} from '@/lib/server/inbox';
import {listKnownUsers} from '@/lib/server/presence';
import {toErrorResponse} from '@/lib/zentra';

export const dynamic = 'force-dynamic';

export const GET = async () => {
  try {
    const [
      {users: beats, truncated},
      {conversations, truncated: threadsTruncated},
      signedIn,
    ] = await Promise.all([
      listKnownUsers(),
      loadConversations(),
      firestoreAccounts(),
    ]);

    const rows = new Map<string, KnownUser>();
    const put = (user: KnownUser) => rows.set(user.email, user);

    // 1. Everybody the app has a name for, and when they last signed in.
    signedIn.forEach(account => {
      put({
        id: `firestore:${account.email}`,
        email: account.email,
        name: account.name,
        lastSeen: account.lastLoginAt ?? 0,
        online: false,
        chatId: chatIdFor(account.email),
        messages: 0,
      });
    });

    // 2. The heartbeats: newer than a sign-in, and the only "online" there is.
    beats.forEach(beat => {
      const known = rows.get(beat.email);
      put({
        ...(known ?? {
          id: beat.id,
          email: beat.email,
          name: null,
          lastSeen: 0,
          online: false,
          chatId: chatIdFor(beat.email),
          messages: 0,
        }),
        // A heartbeat with no document id of its own keeps the first one seen.
        id: known?.id.startsWith('firestore:') ? beat.id : known?.id ?? beat.id,
        // Firestore's name is the record; the heartbeat only repeats it.
        name: known?.name ?? beat.name,
        lastSeen: Math.max(known?.lastSeen ?? 0, beat.lastSeen),
        device: beat.device ?? known?.device,
        online: beat.online,
      });
    });

    // 3. How much has been said, and the last time anything happened at all.
    conversations.forEach(row => {
      const known = rows.get(row.email);
      put({
        ...(known ?? {
          id: `chat:${row.email}`,
          email: row.email,
          name: null,
          lastSeen: 0,
          online: false,
          chatId: row.chatId,
          messages: 0,
        }),
        name: known?.name ?? row.name,
        lastSeen: Math.max(known?.lastSeen ?? 0, row.lastAt),
        online: known?.online ?? Date.now() - row.lastAt < ONLINE_WINDOW_MS,
        chatId: row.chatId || chatIdFor(row.email),
        messages: row.total,
      });
    });

    const merged = [...rows.values()].sort((a, b) => b.lastSeen - a.lastSeen);

    return Response.json({
      users: merged,
      total: merged.length,
      /** Any walk hit its ceiling, so the oldest accounts may be missing. */
      truncated: truncated || threadsTruncated,
      /** True when the names could not be read, so the screen can say so. */
      namesUnavailable: signedIn.size === 0,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
};
