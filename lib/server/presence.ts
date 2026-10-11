/**
 * Presence: who has the app open, and the panel's own heartbeat.
 *
 * The phone app writes its heartbeat straight into the `presence` collection,
 * so the panel's job is small: read the window for the users, and write its own
 * so the app's chat header can honestly say "Online now".
 *
 * The panel's own heartbeat lives under **one id the panel chooses**
 * (`presence_panel_vega-team`), because the store lets a document be created
 * under a name its client picks — which makes the heartbeat a single PATCH and
 * nothing else. See `panelDocumentId` for why that replaced the older
 * "look myself up, cache the id" scheme.
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
  ZtError,
  createDocument,
  queryAll,
  queryDocuments,
  updateDocument,
} from '../zentra';

/** What the panel calls itself in the presence list. */
export const panelHandle = (): string =>
  (process.env.PANEL_HANDLE || 'vega-team').trim().toLowerCase() || 'vega-team';

/**
 * The one document the panel's heartbeat is written to.
 *
 * The store has no upsert, and the first version of this looked its own handle up
 * on every cold start and cached whichever id came back. That turned out to be a
 * duplicate factory: the store's read side is not always current, so a lookup
 * that came back empty threw away a perfectly good heartbeat and made another
 * one — and the presence collection ended up holding four `vega-team` documents,
 * which is what the Live screen showed as four panels and the app's "Online now"
 * dot read as one team that was somehow everywhere.
 *
 * A *chosen* id removes the lookup, and with it the whole class of problem: there
 * is nothing to find, nothing to cache, and nothing to duplicate. A beat is one
 * PATCH; a `404` from that PATCH is the store saying the document is genuinely
 * gone, which is the one case worth creating it again.
 */
export const panelDocumentId = (handle: string = panelHandle()): string =>
  `presence_panel_${handle}`;

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
    name: (doc.data?.name || '').trim() || null,
  };
};

/**
 * One row per account, keeping the freshest heartbeat.
 *
 * The store has no upsert and both clients are apps on an unreliable network, so
 * a second heartbeat document for the same account is not a bug anybody can
 * prevent — and an account showing up twice in a roster is not something anybody
 * should have to read. Whichever document is newest wins, and it brings its
 * device and name with it; the rest are dropped. Ties keep the first seen, so
 * the order the store returned decides rather than nothing at all.
 */
const freshestPerUser = (entries: PresenceEntry[]): PresenceEntry[] => {
  const byUser = new Map<string, PresenceEntry>();
  entries.forEach(entry => {
    const key = `${entry.role}:${entry.user}`;
    const known = byUser.get(key);
    if (!known) {
      byUser.set(key, entry);
      return;
    }
    // A name is worth keeping even when the newer document forgot to send one.
    byUser.set(key, {
      ...(entry.lastSeen > known.lastSeen ? entry : known),
      name:
        (entry.lastSeen > known.lastSeen ? entry.name : known.name) ??
        known.name ??
        entry.name,
      device:
        (entry.lastSeen > known.lastSeen ? entry.device : known.device) ??
        known.device ??
        entry.device,
    });
  });
  return [...byUser.values()];
};

/**
 * What the app calls each account, for the screens that show a name.
 *
 * Read from the same `presence` collection, and it is the only place a name
 * exists: the panel has no credentials for the phone's own user records. An
 * account with no name is left out rather than mapped to an empty string, so the
 * caller's own fallback decides what to draw.
 */
export const namesByEmail = async (): Promise<Map<string, string>> => {
  const {documents} = await queryAll<WirePresence>(
    PRESENCE,
    {orderBy: 'last_seen:desc', limit: 200},
    SCAN_LIMIT,
  );
  const names = new Map<string, string>();
  documents
    .map(toEntry)
    .filter((entry): entry is PresenceEntry => entry !== null)
    .forEach(entry => {
      if (entry.role === 'user' && entry.name && !names.has(entry.user)) {
        names.set(entry.user, entry.name);
      }
    });
  return names;
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
  return freshestPerUser(
    documents
      .map(toEntry)
      .filter((entry): entry is PresenceEntry => entry !== null),
  ).sort((a, b) => b.lastSeen - a.lastSeen);
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
 *
 * A document is not one per account, either, so the rows are folded together by
 * email and the newest heartbeat wins. Two copies of the same person is the one
 * thing a roster cannot survive: every count on the screen, every "open chat"
 * button and every misread of "which one is really them" comes from it.
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
  const users = freshestPerUser(
    documents
      .map(toEntry)
      .filter(
        (entry): entry is PresenceEntry => entry !== null && entry.role === 'user',
      ),
  )
    .map(
      (entry): KnownUser => ({
        id: entry.id,
        email: entry.user,
        name: entry.name,
        lastSeen: entry.lastSeen,
        device: entry.device,
        online: now - entry.lastSeen < ONLINE_WINDOW_MS,
        chatId: chatIdFor(entry.user),
        messages: 0,
      }),
    )
    .sort((a, b) => b.lastSeen - a.lastSeen);
  return {users, truncated};
};

/**
 * Rewrites the panel's own heartbeat: one PATCH at a fixed id, and nothing else
 * in the happy path.
 *
 * ## What it does when the store says no
 *
 * The store is the one part of this system nobody controls, and it is not quiet
 * about being unhappy: it refuses writes with a `503 STORAGE_UNAVAILABLE` for a
 * while and then accepts them again, and a busy hour gets a request that simply
 * times out. Two things follow from that, and they are the whole design here:
 *
 * - **a refusal is not a reason to delete anything.** The previous version threw
 *   the document away and made a new one whenever a PATCH was refused, which on a
 *   store that refuses writes in bursts meant a fresh heartbeat every few
 *   minutes and a stray document for each one. A `503` is a fact about the
 *   store's afternoon, not about our document, so it is passed on as the failure
 *   it is and the next beat patches the same id.
 * - **a `404` is.** `DOCUMENT_NOT_FOUND` is the store saying the document is
 *   genuinely not there, and recreating it is then the correct repair rather
 *   than a duplicate. `DOCUMENT_ALREADY_EXISTS` coming back from that create is
 *   the other half of the same story — another instance of the panel beat us to
 *   it, so the document exists and the next beat patches it.
 */
export const announcePanel = async (): Promise<{handle: string; lastSeen: number}> => {
  const handle = panelHandle();
  const id = panelDocumentId(handle);
  const wire: WirePresence = {
    user: handle,
    role: 'panel',
    last_seen: new Date().toISOString(),
    device: 'web',
  };
  const lastSeen = Date.parse(wire.last_seen as string);

  try {
    await updateDocument(PRESENCE, id, wire);
    return {handle, lastSeen};
  } catch (failure) {
    if (!(failure instanceof ZtError) || failure.status !== 404) {
      throw failure;
    }
  }

  try {
    await createDocument<WirePresence>(PRESENCE, wire, id);
  } catch (failure) {
    if (failure instanceof ZtError && failure.code === 'DOCUMENT_ALREADY_EXISTS') {
      // Somebody else's instance created it between our PATCH and our POST.
      return {handle, lastSeen};
    }
    throw failure;
  }
  return {handle, lastSeen};
};
