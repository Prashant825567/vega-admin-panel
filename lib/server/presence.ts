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
  ONLINE_WINDOW_MS,
  PRESENCE,
  PresenceEntry,
  WirePresence,
} from '../contract';
import {createDocument, queryDocuments, updateDocument} from '../zentra';

/** What the panel calls itself in the presence list. */
export const panelHandle = (): string =>
  (process.env.PANEL_HANDLE || 'vega-team').trim().toLowerCase() || 'vega-team';

/** The document id this instance last wrote, per handle. */
const knownIds = new Map<string, string>();

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
    .map((doc): PresenceEntry | null => {
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
    })
    .filter((entry): entry is PresenceEntry => entry !== null);
};

/**
 * Rewrites the panel's own heartbeat. The first time it looks the handle up and
 * keeps whatever id it finds — after that a beat is a single PATCH. A stale id
 * is forgotten and looked up again.
 */
export const announcePanel = async (): Promise<{handle: string; lastSeen: number}> => {
  const handle = panelHandle();
  const wire: WirePresence = {
    user: handle,
    role: 'panel',
    last_seen: new Date().toISOString(),
    device: 'web',
  };
  const known = knownIds.get(handle);
  if (known) {
    try {
      await updateDocument(PRESENCE, known, wire);
      return {handle, lastSeen: Date.parse(wire.last_seen as string)};
    } catch {
      knownIds.delete(handle);
    }
  }
  const {documents} = await queryDocuments<WirePresence>(PRESENCE, {
    where: [['user', 'eq', handle]],
    limit: 1,
  });
  if (documents.length) {
    await updateDocument(PRESENCE, documents[0].id, wire);
    knownIds.set(handle, documents[0].id);
  } else {
    const created = await createDocument<WirePresence>(PRESENCE, wire);
    knownIds.set(handle, created.id);
  }
  return {handle, lastSeen: Date.parse(wire.last_seen as string)};
};
