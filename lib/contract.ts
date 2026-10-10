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

/**
 * What kind of file rides with a message.
 *
 * `image` is what the app has always sent. `audio` and `video` are recordings —
 * the panel can make both, and the app can make the audio one.
 */
export type MediaKind = 'image' | 'audio' | 'video';

/**
 * How big a file may be, per kind.
 *
 * A screenshot is one frame; a voice note is minutes of talk; a screen recording
 * is both at once. The caps differ because the costs do. These are the panel's
 * own ceilings — the store is asked to hold the bytes, and an upload over its own
 * limit fails with the store's message, which is surfaced as-is.
 */
export const MEDIA_LIMITS: Record<MediaKind, number> = {
  image: 10 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  video: 50 * 1024 * 1024,
};

/**
 * How long a voice note may run. A cap in *time* is the honest one for a
 * recorder: it stops while the person can still see the timer, instead of
 * failing at the end with "too big". Video is uploaded rather than recorded, so
 * it has no clock — only the byte cap in MEDIA_LIMITS.
 */
export const RECORD_LIMIT_MS = 5 * 60_000;

/** What a message with no words says in its place. */
export const MEDIA_LABEL: Record<MediaKind, string> = {
  image: '📷 Screenshot',
  audio: '🎤 Voice note',
  video: '🎥 Video',
};

/**
 * True when a message's whole text is only the label written in place of a
 * missing caption. A player says "🎤 Voice note" on its own line, so a bubble
 * must not print it twice.
 */
export const isMediaPlaceholder = (text: string): boolean => {
  const words = (text || '').trim();
  return !!words && Object.values(MEDIA_LABEL).includes(words);
};

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
  /** What the attached file is. Absent on everything written before media. */
  media_kind?: MediaKind | null;
  /** The file's own type, so a player picks a source without a HEAD request. */
  mime?: string | null;
  /** How long a recording runs, in milliseconds. */
  media_ms?: number | null;
  /** What the file weighed, for the size line under a player. */
  media_bytes?: number | null;
};

/** The media kind a mime type belongs to, or null when nothing matches. */
export const kindFromMime = (mime: string): MediaKind | null => {
  const type = (mime || '').trim().toLowerCase();
  if (type.startsWith('image/')) {
    return 'image';
  }
  if (type.startsWith('audio/')) {
    return 'audio';
  }
  if (type.startsWith('video/')) {
    return 'video';
  }
  return null;
};

/**
 * What kind of file a message carries, if any.
 *
 * Three sources, in order of trust: what the sender declared, what the mime says,
 * and — for everything the app wrote before media existed — the fact that an
 * `image` url is there at all. A message with no `file_id` carries nothing.
 */
export const mediaKindOf = (message: WireMessage): MediaKind | null => {
  if (!message.file_id && !message.image) {
    return null;
  }
  const declared = (message.media_kind || '').toLowerCase();
  if (declared === 'image' || declared === 'audio' || declared === 'video') {
    return declared;
  }
  return kindFromMime(message.mime || '') || 'image';
};

/** What a message with no words shows in a list, whatever it carries. */
export const mediaLabelOf = (message: WireMessage): string => {
  const kind = mediaKindOf(message);
  return kind ? MEDIA_LABEL[kind] : '';
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
  /** The file riding on the last message, so the row can show a mic or a film. */
  lastMedia: MediaKind | null;
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
  /** ZentraGrid file id, when a file is attached. */
  fileId: string | null;
  /** What that file is — a picture, a voice note or a recording. */
  media: MediaKind | null;
  /** The file's own type, for the player. */
  mime: string | null;
  /** How long a recording runs, when the sender declared it. */
  durationMs: number | null;
  /** How much the file weighs. */
  bytes: number | null;
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

/**
 * One account from the roster: what the phone's own heartbeat documents add up
 * to — who has run the app, and when they were last there.
 */
export type KnownUser = {
  /** Presence document id. */
  id: string;
  email: string;
  lastSeen: number;
  device?: string;
  /** Their heartbeat is inside the window, so the app is open right now. */
  online: boolean;
  /** The thread the panel would open for them. */
  chatId: string;
};

/** What the Pulse dashboard shows. */
export type Pulse = {
  threads: number;
  unread: number;
  last24h: number;
  online: number;
};
