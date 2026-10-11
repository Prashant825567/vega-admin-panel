/**
 * What the browser is allowed to call.
 *
 * Every one of these hits this app's own routes, never ZentraGrid: the key lives
 * on the server and the browser has no idea it exists. The types here come from
 * lib/contract.ts, so a change in the wire shape breaks the build rather than
 * silently drifting from the phone app.
 */

import {
  MEDIA_LABEL,
  mediaLabelOf,
  type Conversation,
  type KnownUser,
  type MediaKind,
  type PresenceEntry,
  type Pulse,
  type SentAttachment,
  type ThreadMessage,
  type WireMessage,
} from './contract';

// Re-exported so screens can import both the call and its result type together.
export type {ThreadMessage};

/** A failure with the status and the service's own words in it. */
export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const request = async <T>(input: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(input, {
    cache: 'no-store',
    ...init,
  });
  const body = (await res.json().catch(() => null)) as
    | (T & {error?: string; code?: string})
    | null;
  if (!res.ok) {
    throw new ApiError(
      body?.error || `Request failed (${res.status})`,
      res.status,
      body?.code,
    );
  }
  return body as T;
};

// ---------------------------------------------------------------------------
// Inbox and threads
// ---------------------------------------------------------------------------

export const getInbox = (options: {q?: string; unreadOnly?: boolean} = {}) => {
  const params = new URLSearchParams();
  if (options.q) {
    params.set('q', options.q);
  }
  if (options.unreadOnly) {
    params.set('unreadOnly', '1');
  }
  const query = params.toString();
  return request<{conversations: Conversation[]; truncated: boolean; scanned: number}>(
    `/api/inbox${query ? `?${query}` : ''}`,
  );
};

export const getThread = (chatId: string) =>
  request<{
    chatId: string;
    email: string;
    messages: ThreadMessage[];
    truncated: boolean;
  }>(`/api/thread?chatId=${encodeURIComponent(chatId)}`);

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export const sendMessage = (body: {
  chatId?: string;
  email?: string;
  text: string;
  fileId?: string | null;
  /** The upload's own description of the file it stored. */
  kind?: MediaKind | null;
  mime?: string | null;
  durationMs?: number | null;
  bytes?: number | null;
}) =>
  request<{
    id: string;
    sent_at: string;
    chatId: string;
    announcement: boolean;
    kind: MediaKind | null;
  }>('/api/messages', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });

/**
 * The message fields a file contributes, or nothing at all when there is none.
 */
const describe = (attachment?: SentAttachment) => ({
  fileId: attachment?.fileId ?? null,
  kind: attachment?.kind ?? null,
  mime: attachment?.mime ?? null,
  durationMs: attachment?.durationMs ?? null,
  bytes: attachment?.bytes ?? null,
});

/**
 * Sends one composer's worth of things: the words, plus every file that came
 * with them — in as many messages as there are files, because the wire carries
 * one file per message (that is the shape the phone already reads).
 *
 * The words ride on the **first** message, so the thread reads in the order it
 * was written: the sentence, then the twenty screenshots it was about. Every file
 * after that travels as a bare `📷 Screenshot` / `🎤 Voice note` / `🎥 Video`,
 * which is what the app's list shows for a message with no words of its own.
 *
 * **What it returns is how many of those messages really landed**, and that
 * number is the point of the function: a send that dies halfway must not look
 * like a send that died completely. So the first message is allowed to throw —
 * nothing exists yet, so the caller can safely drop every upload — while a later
 * one is not: it is reported through `onPartial` and counted, so the files whose
 * messages did land are kept.
 */
export const sendBatch = async ({
  chatId,
  text,
  attachments,
  onPartial,
}: {
  chatId: string;
  text: string;
  attachments: SentAttachment[];
  /** Told when only some of a batch went, with the reason for the rest. */
  onPartial?: (message: string) => void;
}): Promise<number> => {
  const [first, ...rest] = attachments;
  if (!first && !text.trim()) {
    return 0;
  }

  await sendMessage({chatId, text, ...describe(first)});
  let claimed = first ? 1 : 0;

  for (const extra of rest) {
    try {
      await sendMessage({
        chatId,
        text: MEDIA_LABEL[extra.kind],
        ...describe(extra),
      });
      claimed += 1;
    } catch (failure) {
      onPartial?.(
        `Sent ${claimed} of ${attachments.length} — ${
          (failure as Error).message || 'the store refused the rest'
        }`,
      );
      break;
    }
  }

  return claimed;
};

export const deleteMessage = (id: string) =>
  request<{id: string; deleted: boolean}>(
    `/api/messages?id=${encodeURIComponent(id)}`,
    {method: 'DELETE'},
  );

/**
 * Removes a file that was uploaded but never claimed by a message. Called when a
 * send fails after its upload, so the store does not keep orphans.
 */
export const deleteUploadedFile = (id: string) =>
  request<{id: string; deleted: boolean}>(
    `/api/upload?id=${encodeURIComponent(id)}`,
    {method: 'DELETE'},
  );

/**
 * The panel's half of the app's blue double tick: the user's messages become
 * `read: true`, which is what the phone paints as "seen by the team".
 */
export const markRead = (chatId: string, ids: string[]) =>
  request<{marked: number; failed: number}>('/api/read', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chatId, ids}),
  });

/**
 * Puts one file in the store and hands back everything a message needs to
 * describe it. `durationMs` is what a recorder knows and the file itself does
 * not: a player can then draw "0:14" before it has downloaded a single byte.
 */
export const uploadMedia = (file: File, durationMs?: number) => {
  const form = new FormData();
  form.append('file', file, file.name);
  if (typeof durationMs === 'number' && durationMs > 0) {
    form.append('durationMs', String(Math.round(durationMs)));
  }
  return request<{
    id: string;
    name: string;
    size: number;
    mimeType: string;
    kind: MediaKind;
    durationMs: number | null;
    label: string;
    url: string;
  }>('/api/upload', {method: 'POST', body: form});
};

// ---------------------------------------------------------------------------
// Presence and Pulse
// ---------------------------------------------------------------------------

export type PresencePayload = {
  users: PresenceEntry[];
  panel: PresenceEntry[];
  onlineCount: number;
  windowMs: number;
  panelHandle: string;
};

export const getPresence = () => request<PresencePayload>('/api/presence');

/** The panel's own heartbeat, so the app can show "Online now". */
export const announcePanel = () =>
  request<{handle: string; lastSeen: number}>('/api/presence', {method: 'POST'});

export const getPulse = () =>
  request<Pulse & {capped: boolean}>('/api/pulse');

/** The roster: every account the app has checked in for, freshest first. */
export const getUsers = () =>
  request<{users: KnownUser[]; total: number; truncated: boolean}>('/api/users');

/**
 * The last message of a thread, for the inbox row. A recording that travelled
 * without words still has to look like something.
 */
export const messagePreview = (message: WireMessage): string =>
  (message.text || '').trim() || mediaLabelOf(message);
