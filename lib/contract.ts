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

/** Newest messages the app shows in one thread. */
export const THREAD_LIMIT = 200;
/** The app shows this many past announcements. */
export const BROADCAST_LIMIT = 20;
/** Ceiling on a full-table walk, so a runaway query cannot hammer the store. */
export const SCAN_LIMIT = 5000;

/**
 * An account counts as online while its heartbeat is inside this window.
 *
 * Three beats of {@link HEARTBEAT_MS}, because the store is not a socket: the
 * phone rewrites one document and the reader has to work out the rest. Three
 * missed beats is a real disappearance; one is a tunnel.
 *
 * This is the **backstop**, not the answer — an app that knows it is leaving
 * writes `away: true` (see `WirePresence`), which takes it off the roster at
 * once. The window only decides the case nobody can announce: a phone that was
 * killed, force-stopped or lost its network mid-beat.
 */
export const ONLINE_WINDOW_MS = 12_000;
/**
 * How often the panel rewrites its own heartbeat.
 *
 * This is also how long the app's "Online now" can lag behind the panel being
 * opened, and how long a closed panel stays on that header: the beat *is* the
 * presence signal in both directions. Four seconds is short enough to read as
 * instant and still one small PATCH each time.
 */
export const HEARTBEAT_MS = 4_000;
/**
 * How often an open inbox re-reads the store.
 *
 * This is the panel's delivery latency: an inbox cannot show a message that has
 * not been asked for. Three seconds is inside the "it just appeared" range,
 * and the pause while the tab is hidden means a background tab is not paying
 * for it (see hooks/usePoll).
 */
export const INBOX_POLL_MS = 3_000;
/**
 * How often an open thread re-reads, so a receipt turns blue on its own.
 *
 * The thread on screen is where the team is actually looking, so it ticks
 * faster than the inbox — a loaded thread is also the one where a stale "sent"
 * tick is most obviously wrong.
 */
export const THREAD_POLL_MS = 2_500;
/**
 * How often the roster and the dashboard re-read.
 *
 * Slower than the two above on purpose: both carry an online dot, so they are
 * presence ticks rather than conversation ticks, and the roster also reads
 * Firestore on every call. Ten seconds is well inside the window an eye notices
 * for a list of people, and it keeps the panel's own users collection out of the
 * fast loop.
 */
export const USERS_POLL_MS = 10_000;
export const PULSE_POLL_MS = 10_000;

/**
 * The collection "typing…" documents live in, and how long one of them lasts.
 *
 * Both sides write one document per (thread, side) and read the other's: the
 * phone says `user`, the panel says `admin`, and neither ever reads its own. It
 * is a fact with an expiry date rather than a flag to clear, which is what makes
 * a composer abandoned mid-sentence stop saying so on its own. Served by the
 * store's hot store, never a Telegram channel — see lib/server/typing.ts.
 *
 * Lives here, and not in the server module that uses it, because the panel's
 * browser half needs the number too and must not import the API key with it.
 */
export const TYPING = 'typing';
export const TYPING_MS = 6_000;

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
 * There are no ceilings on this side of the fence, and that is deliberate.
 *
 * The panel accepts **any number** of files in one go, a mix of pictures and
 * video in the same send, a voice note that runs as long as whoever is talking,
 * and a message as long as the answer needs to be. A support console is exactly
 * where a limit gets in the way: a stack trace, a log dump, a five-minute screen
 * recording and twenty screenshots are all normal things for the team to send.
 *
 * The one real ceiling is the store's, and it is passed through as it is — an
 * upload it refuses comes back in its own words instead of being turned into a
 * guess about megabytes. The phone app keeps limits of its own (ten pictures a
 * send, half a gigabyte a video) because a phone is a phone; nothing here
 * enforces them.
 */

/**
 * A file that is already in the store, described well enough for a message to
 * point at it. The composer produces one per upload; the message route consumes
 * it.
 */
export type SentAttachment = {
  fileId: string;
  kind: MediaKind;
  mime: string;
  durationMs: number | null;
  bytes: number | null;
};

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
  /**
   * Set when the team has hidden a message from its own side only.
   *
   * The document itself stays, so the person who wrote it still has it — which
   * is the whole difference between "delete for me" and "delete for everyone".
   * A hidden message is left out of the thread, out of the inbox, and out of the
   * unread count, exactly as if it had been deleted, without anybody else losing
   * anything.
   */
  hidden_for_team?: boolean | null;
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
  /**
   * What the person is called, as the app has it.
   *
   * Written by the phone on every heartbeat. It is absent on everything that
   * checked in before the field existed, which is why every screen falls back to
   * the email's own first half rather than showing a blank row.
   */
  name?: string | null;
  /**
   * The account is leaving — backgrounded or signing out — right now.
   *
   * `last_seen` alone can only say "was here a moment ago", which is why an
   * app that *can* tell us it is going away writes this instead of waiting for
   * the window to expire: the goodbye is what makes "Offline" instant rather
   * than up to {@link ONLINE_WINDOW_MS} late. Absent on older documents and on
   * ordinary heartbeats, and absent means "here".
   */
  away?: boolean;
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

/**
 * Hidden from the team's own view only — the author still has it.
 *
 * This is what "delete for me" writes on the panel's side, and everything that
 * lists messages has to honour it: a hidden message is not in the thread, not in
 * the inbox, and not part of the unread count. It is the same set of screens
 * that would have shown a deleted one, which is the point.
 */
export const isHiddenForTeam = (message: WireMessage): boolean =>
  message.hidden_for_team === true;

/**
 * Unread *for the team*: the user wrote it, nobody has opened it, and it has not
 * been hidden from the team's view.
 */
export const isUnreadForTeam = (message: WireMessage): boolean =>
  !isFromTeam(message) && message.read !== true && !isHiddenForTeam(message);

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
  /** What the app calls this person, when it has told us. */
  name: string | null;
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
  /** As above: the app's own name for them, when it has one. */
  name: string | null;
  /**
   * The account said it is gone. A reader must treat it as offline whatever
   * `last_seen` says — and the one place that still lists such a row (the
   * roster, which is a history and not a status) reads this to say so.
   */
  away: boolean;
};

/**
 * One account from the roster: what the phone's own heartbeat documents add up
 * to — who has run the app, and when they were last there.
 */
export type KnownUser = {
  /** Presence document id. */
  id: string;
  email: string;
  /** The app's own name for them, when it has one. */
  name: string | null;
  lastSeen: number;
  device?: string;
  /** Their heartbeat is inside the window, so the app is open right now. */
  online: boolean;
  /** The thread the panel would open for them. */
  chatId: string;
  /**
   * How many messages this account and the team have exchanged, or 0 when they
   * have written nothing yet. The account still belongs on the roster: signing
   * in is what puts somebody here, not starting a conversation.
   */
  messages: number;
};

/** What the Pulse dashboard shows. */
export type Pulse = {
  threads: number;
  unread: number;
  last24h: number;
  online: number;
};
