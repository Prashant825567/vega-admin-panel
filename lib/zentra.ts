/**
 * The only place that talks to ZentraGrid. **Server-side only.**
 *
 * Nothing in the browser may import this module: it reads the project-wide API
 * key, and that key can read every collection the project owns and post as the
 * admin. Every browser request goes to this app's own /api/* routes, and those
 * routes are the only callers here.
 *
 * The service has no published docs, so these shapes are the ones it actually
 * returned:
 *
 *   POST   /v1/data/{collection}         201 {id, rev, data, ...}
 *   GET    /v1/data/{collection}?where=  200 {documents: [...], next_cursor}
 *   PATCH  /v1/data/{collection}/{id}    200 {id, rev, data, ...}
 *   DELETE /v1/data/{collection}/{id}    200 {id, deleted: true}
 *   POST   /v1/files                     201 {id, name, size, mime_type, status}
 *   GET    /v1/files/{id}/download       200 bytes — keyed, not public
 *
 * A `where` is `field:operator:value` and may repeat (repeats are ANDed); `eq`,
 * `ne` and `gt` all work. `order_by=field` (or `field:desc`), `limit=N` and
 * `cursor=<next_cursor>` page the results.
 *
 * One hard rule the service enforces with a 400 (`VALIDATION_ERROR`,
 * "query.limit: Input should be less than or equal to 200"): **a page is at
 * most 200 documents**. Asking for more is rejected outright rather than
 * trimmed, so every limit is clamped in one place here — a bigger number would
 * turn a screen into a blank tile instead of just a longer walk.
 */

import {ZtDocument, ZtWhere} from './contract';

/** Data and files live on the same host. */
export const ZENTRAGRID_BASE = 'https://zentragrid.onrender.com';

/** No call may hang a screen forever. Uploads and downloads get their own budget. */
const TIMEOUT_MS = 15_000;
const TRANSFER_TIMEOUT_MS = 60_000;

/** The service's own ceiling: `limit` above this is a 400, not a truncation. */
export const MAX_PAGE_LIMIT = 200;

/** A failure the API routes can turn into a status code and a readable message. */
export class ZtError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 502, code?: string) {
    super(message);
    this.name = 'ZtError';
    this.status = status;
    this.code = code;
  }
}

/** The key, or a failure that says exactly what is missing. */
const apiKey = (): string => {
  const key = process.env.ZENTRAGRID_API_KEY?.trim();
  if (!key) {
    throw new ZtError(
      'ZENTRAGRID_API_KEY is not set on the server — add it to .env.local (and to Vercel → Settings → Environment Variables)',
      500,
      'MISSING_KEY',
    );
  }
  return key;
};

/** Reads the service's own error message so the UI can show something real. */
const failure = async (res: Response): Promise<ZtError> => {
  let message = '';
  let code: string | undefined;
  try {
    const body = (await res.json()) as {
      error?: {message?: string; code?: string};
      message?: string;
    };
    message = body?.error?.message || body?.message || '';
    code = body?.error?.code;
  } catch {
    // Not a JSON body — fall through to the status line.
  }
  if (res.status === 401) {
    return new ZtError(
      message || 'ZentraGrid rejected the key (check ZENTRAGRID_API_KEY)',
      401,
      code || 'INVALID_ID_TOKEN',
    );
  }
  // The store's own 4xx verdicts are about the request (a missing document, a
  // bad parameter), so they are passed through as-is — flattening them to a
  // 502 would tell the browser "the store is down" and hide the real reason.
  // Anything 5xx is re-stamped 502: from here it is an upstream failure.
  const status = res.status >= 400 && res.status < 500 ? res.status : 502;
  return new ZtError(
    message || `ZentraGrid refused the request (${res.status})`,
    status,
    code,
  );
};

type CallOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: BodyInit;
  /** JSON calls must say so; multipart must NOT, the boundary comes from FormData. */
  json?: boolean;
  timeoutMs?: number;
};

const call = async (path: string, options: CallOptions = {}): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? TIMEOUT_MS,
  );
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey()}`,
    };
    if (options.json) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${ZENTRAGRID_BASE}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      throw await failure(res);
    }
    return res;
  } catch (error) {
    if (error instanceof ZtError) {
      throw error;
    }
    if ((error as {name?: string})?.name === 'AbortError') {
      throw new ZtError('ZentraGrid did not answer in time', 504, 'TIMEOUT');
    }
    throw new ZtError(
      (error as {message?: string})?.message || 'Could not reach ZentraGrid',
      502,
      'UNREACHABLE',
    );
  } finally {
    clearTimeout(timer);
  }
};

export type ZtQuery = {
  where?: ZtWhere[];
  orderBy?: string;
  limit?: number;
  cursor?: string;
};

const queryString = (query: ZtQuery): string => {
  const params: string[] = [];
  (query.where || []).forEach(([field, operator, value]) => {
    // Field and operator stay literal; only the value is percent-encoded, so an
    // email or an ISO timestamp survives the trip intact.
    params.push(`where=${field}:${operator}:${encodeURIComponent(value)}`);
  });
  if (query.orderBy) {
    params.push(`order_by=${encodeURIComponent(query.orderBy)}`);
  }
  if (typeof query.limit === 'number' && query.limit > 0) {
    params.push(`limit=${Math.min(Math.floor(query.limit), MAX_PAGE_LIMIT)}`);
  }
  if (query.cursor) {
    params.push(`cursor=${encodeURIComponent(query.cursor)}`);
  }
  return params.length ? `?${params.join('&')}` : '';
};

/** One page of documents. */
export const queryDocuments = async <T>(
  collection: string,
  query: ZtQuery = {},
): Promise<{documents: ZtDocument<T>[]; nextCursor: string | null}> => {
  const res = await call(`/v1/data/${collection}${queryString(query)}`);
  const body = (await res.json()) as {
    documents?: ZtDocument<T>[];
    next_cursor?: string | null;
  };
  return {
    documents: Array.isArray(body?.documents) ? body.documents : [],
    nextCursor: body?.next_cursor || null,
  };
};

/**
 * Every page of a query, walked to the end (or to the ceiling). The store hands
 * out pages, so one call is never the whole collection.
 */
export const queryAll = async <T>(
  collection: string,
  query: ZtQuery = {},
  maxDocuments = 5000,
): Promise<{documents: ZtDocument<T>[]; truncated: boolean}> => {
  const documents: ZtDocument<T>[] = [];
  let cursor: string | undefined;
  let truncated = false;
  for (let page = 0; page < 40; page += 1) {
    const result = await queryDocuments<T>(collection, {...query, cursor});
    documents.push(...result.documents);
    if (!result.nextCursor || !result.documents.length) {
      return {documents, truncated};
    }
    if (documents.length >= maxDocuments) {
      return {documents, truncated: true};
    }
    cursor = result.nextCursor;
  }
  truncated = true;
  return {documents, truncated};
};

/** Writes one document and hands back the stored record. */
export const createDocument = async <T extends object>(
  collection: string,
  data: T,
): Promise<ZtDocument<T>> => {
  const res = await call(`/v1/data/${collection}`, {
    method: 'POST',
    json: true,
    body: JSON.stringify({data}),
  });
  return (await res.json()) as ZtDocument<T>;
};

/** Merges a patch into an existing document (fields left out are kept). */
export const updateDocument = async <T extends object>(
  collection: string,
  id: string,
  patch: Partial<T>,
): Promise<ZtDocument<T>> => {
  const res = await call(`/v1/data/${collection}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    json: true,
    body: JSON.stringify({data: patch}),
  });
  return (await res.json()) as ZtDocument<T>;
};

/** Deletes one document. */
export const deleteDocument = async (
  collection: string,
  id: string,
): Promise<void> => {
  await call(`/v1/data/${collection}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
};

/** The download URL the app itself writes into a message. */
export const fileUrl = (fileId: string): string =>
  `${ZENTRAGRID_BASE}/v1/files/${fileId}/download`;

/** Uploads one screenshot and returns its file record. */
export const uploadFile = async (
  file: File,
): Promise<{id: string; name?: string; size?: number; mime_type?: string}> => {
  const body = new FormData();
  body.append('file', file, file.name || 'screenshot.jpg');
  const res = await call('/v1/files', {
    method: 'POST',
    body,
    timeoutMs: TRANSFER_TIMEOUT_MS,
  });
  return (await res.json()) as {id: string; name?: string};
};

/**
 * Streams a stored file back. ZentraGrid serves nothing without the key, so an
 * `<img src>` can never point at it directly — this is what /api/file proxies.
 */
export const downloadFile = async (fileId: string): Promise<Response> =>
  call(`/v1/files/${encodeURIComponent(fileId)}/download`, {
    timeoutMs: TRANSFER_TIMEOUT_MS,
  });

/** Turns any thrown value into the JSON response an API route should send. */
export const toErrorResponse = (error: unknown): Response => {
  if (error instanceof ZtError) {
    return Response.json(
      {error: error.message, code: error.code},
      {status: error.status},
    );
  }
  return Response.json(
    {
      error:
        (error as {message?: string})?.message || 'Something went wrong',
      code: 'UNKNOWN',
    },
    {status: 500},
  );
};
