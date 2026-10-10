/**
 * What the browser is allowed to call.
 *
 * Every one of these hits this app's own routes, never ZentraGrid: the key lives
 * on the server and the browser has no idea it exists. The types here come from
 * lib/contract.ts, so a change in the wire shape breaks the build rather than
 * silently drifting from the phone app.
 */

import type {
  Conversation,
  PresenceEntry,
  Pulse,
  ThreadMessage,
  WireMessage,
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
    maxLength: number;
  }>(`/api/thread?chatId=${encodeURIComponent(chatId)}`);

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export const sendMessage = (body: {
  chatId?: string;
  email?: string;
  text: string;
  fileId?: string | null;
}) =>
  request<{id: string; sent_at: string; chatId: string; announcement: boolean}>(
    '/api/messages',
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    },
  );

export const deleteMessage = (id: string) =>
  request<{id: string; deleted: boolean}>(
    `/api/messages?id=${encodeURIComponent(id)}`,
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

export const uploadScreenshot = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return request<{
    id: string;
    name: string;
    size: number;
    mimeType: string;
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

/** The last message of a thread, for the inbox row. */
export const messagePreview = (message: WireMessage): string =>
  (message.text || '').trim() || (message.file_id ? '📷 Screenshot' : '');
