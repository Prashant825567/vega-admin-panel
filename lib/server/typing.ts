/**
 * "typing…" — the smallest document in the store, and the one that has to be the
 * cheapest.
 *
 *   chat_id  which thread is being written in
 *   from     `user` for the phone, `admin` for the panel
 *   until    ISO 8601, when this stops being true
 *
 * Neither side keeps a state called "typing" anywhere, because a keystroke is
 * not a state — it is a fact with an expiry date. `until` is that date, so
 * nothing has to be cleaned up, and a composer that is abandoned half-sentence
 * stops saying so on its own a few seconds later. Both sides read the *other*
 * one's document and ignore their own, which is what stops a panel from
 * announcing that the panel is typing.
 *
 * The collection is served by the store's hot store rather than a Telegram
 * channel (see ZG_HOT_COLLECTIONS in the storage service): a write every couple
 * of seconds to a chat that allows about one per second is how an account earns
 * a flood wait, and this traffic must never be in the same queue as a real
 * message.
 *
 * ## Why a chosen id, again
 *
 * Presence learned this the hard way: the store has no upsert, so a lookup that
 * comes back empty (and its reads are not always current) is how one account
 * ends up with four documents. A document id this panel picks — derived from the
 * thread and the role — removes the lookup and the duplicates with it. The phone
 * picks the matching id for its own half, and neither side ever has to know the
 * other's.
 */

import {TYPING, TYPING_MS} from '@/lib/contract';
import {ZtError, createDocument, queryDocuments, updateDocument} from '@/lib/zentra';

// The collection name and the lifetime come from lib/contract: both sides need
// them, and the browser half must not import this module (it holds the key).
export {TYPING, TYPING_MS};

/** Which side wrote a document. The phone says `user`; this panel says `admin`. */
export type TypingRole = 'user' | 'admin';

/**
 * The one document a (thread, side) pair is written to.
 *
 * `chat_ram@vega.app` and `user` become `typing_user_chat-ram-vega-app`: unique by
 * construction, readable in a store console, and stable across restarts — which
 * is the whole point, because a stable id is what makes a beat one PATCH.
 */
export const typingDocumentId = (chatId: string, role: TypingRole): string => {
  const slug = (chatId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `typing_${role}_${slug}`;
};

/**
 * Says the panel is typing in this thread, or that it has stopped.
 *
 * The happy path is a single PATCH at a known id. A `404` is the store saying the
 * document is genuinely not there (this thread has never had an admin type in it)
 * and creating it is the correct repair; `409` is another instance of the panel
 * beating us to that create, which is the same outcome. Anything else is thrown:
 * the route reports it, and the caller — the composer — does not care, because a
 * typing indicator that fails has nothing to say to anybody.
 */
export const announceTyping = async (
  chatId: string,
  typing = true,
): Promise<void> => {
  const id = typingDocumentId(chatId, 'admin');
  const wire = {
    chat_id: chatId,
    from: 'admin',
    until: new Date(Date.now() + (typing ? TYPING_MS : 0)).toISOString(),
  };
  try {
    await updateDocument(TYPING, id, wire);
    return;
  } catch (failure) {
    if (!(failure instanceof ZtError) || failure.status !== 404) {
      throw failure;
    }
  }
  try {
    await createDocument(TYPING, wire, id);
  } catch (failure) {
    if (failure instanceof ZtError && failure.code === 'DOCUMENT_ALREADY_EXISTS') {
      return;
    }
    throw failure;
  }
};

/**
 * Is the person on the phone typing in this thread right now?
 *
 * Filtered on what the store can filter on (`chat_id` and `from`), and the expiry
 * is read here rather than in a `where`, so a document that is merely old costs
 * one comparison instead of a second round trip. The phone's document is the only
 * one this looks at: the panel's own is for the app to read.
 */
export const isUserTyping = async (chatId: string): Promise<boolean> => {
  try {
    const {documents} = await queryDocuments<{until?: string; from?: string}>(
      TYPING,
      {
        where: [
          ['chat_id', 'eq', chatId],
          ['from', 'eq', 'user'],
        ],
        limit: 5,
      },
    );
    const now = Date.now();
    return documents.some(doc => {
      const until = Date.parse(doc.data?.until || '');
      return Number.isFinite(until) && until > now;
    });
  } catch {
    // No answer is the same as "not typing": the header falls back to the last
    // heartbeat instead of claiming something nobody confirmed.
    return false;
  }
};
