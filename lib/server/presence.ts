/**
 * Presence: who has the app open, and the panel's own heartbeat.
 *
 * The phone app writes its heartbeat straight into the `presence` collection,
 * so the panel's job is small: read the window for the users, and write its own
 * so the app's chat header can honestly say "Online now".
 *
 * The panel's own document id is kept in a module-level variable. Vercel keeps a
 * warm instance around between requests, so a heartbeat is normally ONE PATCH;
 * a cold start pays for a lookup once and then remembers again. That cache is a
 * best effort on purpose — losing it costs one extra request, nothing else.
 */

import {
  KnownUser,
  ONLINE_WINDOW_MS,
  PRESENCE,
  PresenceEntry,
  SCAN_LIMIT,
  WirePresence,
  chatIdFor,
} from '../contract';
import {
  createDocument,
  deleteDocument,
  queryAll,
  queryDocuments,
  updateDocument,
} from '../zentra';

/** What the panel calls itself in the presence list. */
export const panelHandle = (): string =>
  (process.env.PANEL_HANDLE || 'vega-team').trim().toLowerCase() || 'vega-team';

/** The document id this instance last wrote, per handle. */
const knownIds = new Map<string, string>();

/**
 * One presence document as a screen sees it, or null when it says nothing — no
 * account, or a `last_seen` that is not a date. The role is normalised the same
 * way everywhere: only a document that says `panel` is the panel, because a
 * document written before the field existed is a user.
 */
const toEntry = (doc: {id: string; data?: WirePresence}): PresenceEntry | null => {
  const user = (doc.data?.user || '').trim().toLowerCase();
  const lastSeen = Date.parse(doc.data?.last_seen || '');
  if (!user || !Number.isFinite(lastSeen)) {
    return null;
  }
  return {
    id: doc.id,
    user,
    role: doc.data?.role === 'panel' ? 'panel' : 'user',
    lastSeen,
    device: doc.data?.device || undefined,
  };
};

/** Everyone seen inside the window, freshest first. */
export const listOnline = async (
  role?: 'user' | 'panel',
): Promise<PresenceEntry[]> => {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  const where: [string, string, string][] = [['last_seen', 'gt', cutoff]];
  if (role) {
    where.push(['role', 'eq', role]);
  }
  const {documents} = await queryDocuments<WirePresence>(PRESENCE, {
    where,
    orderBy: 'last_seen',
    limit: 200,
  });
  return documents
    .map(toEntry)
    .filter((entry): entry is PresenceEntry => entry !== null);
};

/**
 * Every account the app has ever checked in for, freshest first — the roster.
 *
 * The phone writes one heartbeat document per account and keeps rewriting it, so
 * the collection is the closest thing to a sign-up list this panel can see: an
 * account appears the first time the app runs signed in, and its `last_seen` is
 * whatever it did last. Nothing is filtered by time here, which is the whole
 * difference between this and `listOnline`.
 *
 * It is *not* a sign-up list in the strict sense: an account that has never run
 * the app has no document, and the panel only reads ZentraGrid — the phone's
 * own users collection is a different store it has no credentials for. The
 * screen says so rather than implying it has everybody.
 */
export const listKnownUsers = async (): Promise<{
  users: KnownUser[];
  truncated: boolean;
}> => {
  const {documents, truncated} = await queryAll<WirePresence>(
    PRESENCE,
    {orderBy: 'last_seen:desc', limit: 200},
    SCAN_LIMIT,
  );
  const now = Date.now();
  const users = documents
    .map(toEntry)
    .filter((entry): entry is PresenceEntry => entry !== null && entry.role === 'user')
    .map(
      (entry): KnownUser => ({
        id: entry.id,
        email: entry.user,
        lastSeen: entry.lastSeen,
        device: entry.device,
        online: now - entry.lastSeen < ONLINE_WINDOW_MS,
        chatId: chatIdFor(entry.user),
      }),
    )
    .sort((a, b) => b.lastSeen - a.lastSeen);
  return {users, truncated};
};

/**
 * Rewrites the panel's own heartbeat. The first time it looks the handle up and
 * keeps whatever id it finds — after that a beat is a single PATCH. A stale id
 * is forgotten and looked up again.
 *
 * ## Why this repairs itself
 *
 * The store is the one part of this system nobody controls, and it is not quiet
 * about being unhappy: a long-lived document that is rewritten every 20 seconds
 * eventually starts answering PATCH with its own `Failed to update record.`,
 * and a busy hour gets a request that simply times out. Left alone, either one
 * pins the panel as "away" in the app's chat header for as long as it runs — and
 * shows a red banner to somebody whose only mistake was leaving the tab open.
 *
 * So a refused update is treated as a fact about the *document*, not the
 * request: the id is dropped, and if the document was found by lookup it is
 * deleted and a fresh heartbeat is created in its place. Presence is disposable
 * by definition — the worst case is a user seeing the team as away for one
 * heartbeat — which makes throwing the document away the right repair instead of
 * retrying something the store has already refused.
 */
export const announcePanel = async (): Promise<{handle: string; lastSeen: number}> => {
  const handle = panelHandle();
  const wire: WirePresence = {
    user: handle,
    role: 'panel',
    last_seen: new Date().toISOString(),
    device: 'web',
  };
  const lastSeen = Date.parse(wire.last_seen as string);

  const known = knownIds.get(handle);
  if (known) {
    try {
      await updateDocument(PRESENCE, known, wire);
      return {handle, lastSeen};
    } catch {
      knownIds.delete(handle);
    }
  }

  const {documents} = await queryDocuments<WirePresence>(PRESENCE, {
    where: [['user', 'eq', handle]],
    limit: 1,
  });

  if (documents.length) {
    try {
      await updateDocument(PRESENCE, documents[0].id, wire);
      knownIds.set(handle, documents[0].id);
      return {handle, lastSeen};
    } catch {
      // The store handed us this document and then refused to update it. The
      // document is what is broken, so it goes — see the note above.
      await deleteDocument(PRESENCE, documents[0].id).catch(() => {});
    }
  }

  const created = await createDocument<WirePresence>(PRESENCE, wire);
  knownIds.set(handle, created.id);
  return {handle, lastSeen};
};
