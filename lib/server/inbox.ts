/**
 * Reading the store the way the inbox thinks.
 *
 * The `messages` collection is flat — one document per message, with no
 * "conversation" record anywhere — and the service hands out pages, not a
 * table. So the inbox is built here, on the server: walk the collection once,
 * group by `chat_id`, and hand the browser a small list of conversations
 * instead of every message ever sent.
 *
 * Both the inbox and the Pulse dashboard read through this, so the two screens
 * can never disagree about how many threads there are or what is unread.
 */

import {
  BROADCAST_CHAT,
  Conversation,
  MESSAGES,
  SCAN_LIMIT,
  WireMessage,
  atOf,
  emailOf,
  isBroadcast,
  isFromTeam,
  isUnreadForTeam,
} from '../contract';
import {queryAll} from '../zentra';

export type InboxResult = {
  conversations: Conversation[];
  /** The walk hit its ceiling, so the oldest threads may be missing. */
  truncated: boolean;
  /** How many documents were looked at, for the honesty line in the UI. */
  scanned: number;
};

/** A one-line preview of a message, whatever kind it is. */
const previewOf = (message: WireMessage): string => {
  const text = (message.text || '').trim();
  if (text) {
    return text.length > 140 ? `${text.slice(0, 137)}…` : text;
  }
  return message.file_id ? '📷 Screenshot' : '(empty message)';
};

/**
 * Every conversation, newest activity first. Scanned once per request: the
 * panel is a small internal tool, and one walk of the collection is cheaper and
 * far simpler than paging per thread on every refresh.
 */
export const loadConversations = async (): Promise<InboxResult> => {
  const {documents, truncated} = await queryAll<WireMessage>(
    MESSAGES,
    {
      // Announcements are their own screen; they never appear as a thread.
      where: [['chat_id', 'ne', BROADCAST_CHAT]],
      orderBy: 'sent_at:desc',
      limit: 200,
    },
    SCAN_LIMIT,
  );

  const byChat = new Map<string, Conversation>();

  documents.forEach(doc => {
    const wire = doc.data || {};
    const chatId = (wire.chat_id || '').trim();
    if (!chatId || isBroadcast(chatId)) {
      return;
    }
    // A message with no `sent_at` still has to sort somewhere sensible.
    const at = atOf(wire) || Date.parse(doc.created_at || '') || 0;
    const conversation =
      byChat.get(chatId) ||
      ({
        chatId,
        email: emailOf(chatId),
        lastText: '',
        lastAt: 0,
        lastFrom: 'user',
        hasImage: false,
        unread: 0,
        total: 0,
      } satisfies Conversation);

    conversation.total += 1;
    if (isUnreadForTeam(wire)) {
      conversation.unread += 1;
    }
    // The walk is newest-first, so the first document seen for a thread is the
    // latest one — that is what the row shows.
    if (at >= conversation.lastAt) {
      conversation.lastAt = at;
      conversation.lastText = previewOf(wire);
      conversation.lastFrom = isFromTeam(wire) ? 'team' : 'user';
      conversation.hasImage = Boolean(wire.file_id);
    }
    byChat.set(chatId, conversation);
  });

  const conversations = [...byChat.values()].sort((a, b) => b.lastAt - a.lastAt);
  return {conversations, truncated, scanned: documents.length};
};

/** The same numbers, totalled — this is what Pulse puts on its tiles. */
export const totalsOf = (
  conversations: Conversation[],
): {threads: number; unread: number} => ({
  threads: conversations.length,
  unread: conversations.reduce((sum, row) => sum + row.unread, 0),
});
