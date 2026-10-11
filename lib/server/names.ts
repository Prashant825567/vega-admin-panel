/**
 * What to call somebody, from the two places that know.
 *
 *   Firestore `users/{email}`  the name they typed at sign-in — the real one
 *   presence `name`            the same name, as the phone last reported it
 *
 * Firestore wins, because it is the record the app itself treats as
 * authoritative: it is unique across accounts, it is what the app greets the
 * person with on the way back, and renaming is not even implemented. Presence is
 * the fallback for the case where Firestore cannot be reached but the heartbeat
 * still arrived — the same name, one hop closer.
 *
 * There is deliberately **no third source**. A name invented from an email's
 * first half is the one thing this must never do: it reads exactly like a real
 * name, so nobody can tell which rows are people and which are guesses. With no
 * name from either source, callers get null and show the address, which at least
 * says what it is.
 */

import {firestoreAccounts} from './firestore';
import {namesByEmail} from './presence';

/** The name for each account that has one, keyed by lowercased email. */
export const accountNames = async (): Promise<Map<string, string>> => {
  const [fromFirestore, fromPresence] = await Promise.all([
    firestoreAccounts(),
    // Presence is the panel's own store; a failure there is not a failure here.
    namesByEmail().catch(() => new Map<string, string>()),
  ]);

  const names = new Map<string, string>();
  fromPresence.forEach((name, email) => names.set(email, name));
  // Firestore overwrites presence: the first is the record, the second a copy.
  fromFirestore.forEach((account, email) => names.set(email, account.name));
  return names;
};

/** The name for one account, or null when neither source has one. */
export const nameOf = async (email: string): Promise<string | null> => {
  const names = await accountNames();
  return names.get((email || '').trim().toLowerCase()) ?? null;
};
