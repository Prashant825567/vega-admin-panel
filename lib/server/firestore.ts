/**
 * The names behind a sign-in, read from the phone's own Firestore.
 *
 * The app's **Sign in with Google** flow asks a first-time visitor for a name and
 * writes it to `users/{emailLower}` — the name is unique across accounts, it is
 * what the app greets them with on the way back, and it is the only place a real
 * name exists at all. The admin panel has no Firebase SDK and no signed-in
 * session, so it reads the same data over Firestore's REST API instead.
 *
 * Two things make that legitimate rather than a shortcut:
 *
 * - **the values are public configuration.** The project id and the web API key
 *   are exactly what ships inside every APK (`google-services.json`); they are not
 *   secrets, and the only thing they can do here is what the published rules
 *   allow. They are still overridable by `FIREBASE_PROJECT_ID` and
 *   `FIREBASE_API_KEY`, so a different project needs no code change.
 * - **nothing else is read from Firestore.** Not the messages, not the auth
 *   tokens, not any other collection: this file asks one question — "what does
 *   this account call itself?" — and answers it with a map.
 *
 * ## Why it is cached
 *
 * The roster is asked for every 30 seconds and the Firestore read costs a round
 * trip plus a cold start now and then, while a name changes approximately never.
 * A short in-memory window (per server instance) is the difference between a
 * screen that opens instantly and one that waits on Google to say "Jyoti" again.
 * A failed read is *not* cached as a failure for long: the next attempt is worth
 * making, and the callers fall back to the email meanwhile.
 */

/** Public app configuration, overridable by environment. */
const PROJECT_ID = (process.env.FIREBASE_PROJECT_ID || 'vega-70de0').trim();
const API_KEY = (process.env.FIREBASE_API_KEY || "AIzaSyDhNHvvn2qhBcXtfWsJGDqiSlzNK7AZUCE").trim();

/** How long a name is trusted before it is asked for again. */
const CACHE_MS = 60_000;

/** No call may hang a screen; Firestore answers this in tens of milliseconds. */
const TIMEOUT_MS = 8_000;

export type FirestoreAccount = {
  email: string;
  name: string;
  photo: string | null;
  /** When they last signed in, as the app recorded it. */
  lastLoginAt: number | null;
};

let cache: {at: number; accounts: Map<string, FirestoreAccount>} | null = null;

/** One Firestore field, whichever of its typed forms it arrived in. */
const stringField = (
  fields: Record<string, {stringValue?: string; integerValue?: string}> | undefined,
  key: string,
): string => (fields?.[key]?.stringValue || '').trim();

const numberField = (
  fields: Record<string, {stringValue?: string; integerValue?: string}> | undefined,
  key: string,
): number | null => {
  const raw = fields?.[key]?.integerValue ?? fields?.[key]?.stringValue;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
};

/**
 * Every account the app has a name for, keyed by lowercased email.
 *
 * Never throws. A panel that cannot reach Firestore still has an inbox to show,
 * and the rows fall back to the address — which is what they did before any of
 * this existed.
 */
export const firestoreAccounts = async (): Promise<Map<string, FirestoreAccount>> => {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache.accounts;
  }

  const accounts = new Map<string, FirestoreAccount>();
  try {
    const url =
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(PROJECT_ID)}` +
      `/databases/(default)/documents/users?pageSize=300&key=${encodeURIComponent(API_KEY)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {signal: controller.signal, cache: 'no-store'});
      if (res.ok) {
        const body = (await res.json()) as {
          documents?: {name?: string; fields?: Record<string, never>}[];
        };
        (body.documents || []).forEach(doc => {
          const fields = doc.fields as unknown as Record<
            string,
            {stringValue?: string; integerValue?: string}
          >;
          // The document id *is* the lowercased email, and `emailLower` repeats
          // it; either one is fine, the id is what the rules guarantee.
          const email =
            stringField(fields, 'emailLower') ||
            (doc.name || '').split('/').pop()?.toLowerCase() ||
            '';
          const name = stringField(fields, 'name');
          if (!email || !name) {
            return;
          }
          accounts.set(email, {
            email,
            name,
            photo: stringField(fields, 'photo') || null,
            lastLoginAt: numberField(fields, 'lastLoginAt'),
          });
        });
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Offline, blocked, or the key rotated: names are a nicety, not a
    // prerequisite. An empty map means every caller falls back to the address.
  }

  // A successful read is remembered; a failed one is remembered briefly, so a
  // page that polls every 30 seconds cannot turn a bad minute into a stampede.
  cache = {at: accounts.size ? Date.now() : Date.now() - CACHE_MS + 15_000, accounts};
  return accounts;
};

/** The service's name for one account, or null when it has never signed in. */
export const firestoreNameOf = async (email: string): Promise<string | null> => {
  const accounts = await firestoreAccounts();
  return accounts.get((email || '').trim().toLowerCase())?.name ?? null;
};
