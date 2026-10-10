/**
 * The contract with the phone app, in one place.
 *
 * Everything here is safe on both sides of the fence — the server routes and the
 * browser both import it — so there is exactly one definition of a chat id, one
 * window for "online", and one shape for a stored message. The values are the
 * ones the app itself uses (src/lib/services/supportChat.ts); changing any of
 * them here without changing the app would silently break the conversation.
 */

/** Collection every message lives in. */
export const MESSAGES = 'messages';
/** Collection the presence heartbeats live in. */
export const PRESENCE = 'presence';

/** Who the team is, as far as the app is concerned. */
export const ADMIN = 'admin';
/** The announcement thread everyone in the app sees. */
export const BROADCAST_CHAT = 'chat_broadcast';

/** Longest message the app's composer allows; the panel matches it. */
export const MAX_MESSAGE_LENGTH = 1000;
/** Newest messages the app shows in one thread. */
export const THREAD_LIMIT = 200;
/** The app shows this many past announcements. */
export const BROADCAST_LIMIT = 20;
/** Ceiling on a full-table walk, so a runaway query cannot hammer the store. */
export const SCAN_LIMIT = 5000;

/** An account counts as online while its heartbeat is inside this window. */
export const ONLINE_WINDOW_MS = 60_000;
/** How often the panel rewrites its own heartbeat. */
export const HEARTBEAT_MS = 20_000;
/** How often an open inbox re-reads the store. */
export const INBOX_POLL_MS = 15_000;
/** How often an open thread re-reads, so a receipt turns blue on its own. */
export const THREAD_POLL_MS = 10_000;

export type ZtDocument<T> = {
  id: string;
  rev?: number;
  created_at?: string;
  updated_at?: string;
  data: T;
};

/** `[field, operator, value]` — repeats are ANDed by the store. */
export type ZtWhere = [field: string, operator: string, value: string];

/** One message, exactly as the app writes it. */
export type WireMessage = {
  chat_id?: string;
  from?: string;
  to?: string;
  text?: string;
  sent_at?: string;
  read?: boolean;
  image?: string | null;
  file_id?: string | null;
};

/** One presence heartbeat. */
export type WirePresence = {
  user?: string;
  role?: string;
  last_seen?: string;
  device?: string;
};

/** The thread this account talks to the team in. Lowercase, always. */
export const chatIdFor = (email: string): string =>
  `chat_${(email || '').trim().toLowerCase()}`;

/** The account behind a thread id. */
export const emailOf = (chatId: string): string =>
  (chatId || '').replace(/^chat_/, '');

/** Announcements are one shared document and belong to nobody in particular. */
export const isBroadcast = (chatId: string): boolean =>
  chatId === BROADCAST_CHAT;

/** A message from the team, rather than from the user. */
export const isFromTeam = (message: WireMessage): boolean =>
  (message.from || '').trim().toLowerCase() === ADMIN;

/** Unread *for the team*: the user wrote it and nobody has opened it. */
export const isUnreadForTeam = (message: WireMessage): boolean =>
  !isFromTeam(message) && message.read !== true;

/** When a message happened, in milliseconds — never NaN. */
export const atOf = (message: WireMessage): number => {
  const at = Date.parse(message.sent_at || '');
  return Number.isFinite(at) ? at : 0;
};

/** A conversation as the inbox thinks of it: one thread and its last message. */
export type Conversation = {
  chatId: string;
  email: string;
  lastText: string;
  lastAt: number;
  lastFrom: 'user' | 'team';
  hasImage: boolean;
  unread: number;
  total: number;
};

/**
 * One message as a screen sees it: the wire document, flattened to the three
 * things a bubble needs — who wrote it, what it says, and whether the other side
 * has opened it.
 */
export type ThreadMessage = {
  id: string;
  /** Who wrote it, from the app's point of view. */
  from: 'user' | 'team';
  text: string;
  /** ZentraGrid file id, when a screenshot is attached. */
  fileId: string | null;
  /** Millisecond epoch. */
  at: number;
  /** The other side has seen it. */
  read: boolean;
};

/** One account seen recently, from the `presence` collection. */
export type PresenceEntry = {
  id: string;
  user: string;
  role: 'user' | 'panel';
  lastSeen: number;
  device?: string;
};

/** What the Pulse dashboard shows. */
export type Pulse = {
  threads: number;
  unread: number;
  last24h: number;
  online: number;
};
