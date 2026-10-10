# Vega Support Console

The admin side of the Vega app's support chat. It reads every conversation the
phone app has started, answers into the same thread, posts announcements, shows
who is online right now, and writes the read receipts that turn the app's tick
blue.

Built as a **Next.js app** on purpose: it is one deployable unit, Vercel is its
native home, and the ZentraGrid key never has to reach the browser — every store
call happens in this app's own `/api/*` routes.

---

## What it talks to

Everything lives in the same hosted JSON store the phone app writes to:

```
https://zentragrid.onrender.com          Authorization: Bearer <ZENTRAGRID_API_KEY>
```

Two collections, and nothing else:

| collection | what is in it |
| --- | --- |
| `messages` | one document per message — `chat_id`, `from`, `to`, `text`, `sent_at`, `read`, `image`, `file_id` |
| `presence` | one heartbeat per account — `user`, `role`, `last_seen`, `device` |

The rules that keep the two sides compatible (all in `lib/contract.ts`):

- a user's thread is `chat_<their email, lowercased>`; announcements are
  `chat_broadcast`;
- a reply must look exactly like
  `{chat_id, from: "admin", to: <email>, text, sent_at: <ISO>, read: false, image, file_id}`;
- `read: true` on a message the **user** wrote means *the team has seen it* —
  that is the app's blue double tick. `read: true` on an admin reply means *the
  user has seen it*. Both are written here, and the thread screen writes the
  first one whenever it opens;
- an account is online while its `last_seen` is inside the last 60 seconds. The
  panel rewrites its own heartbeat every 20 seconds, which is what makes the app's
  chat header say "Online now";
- **never** mark a `chat_broadcast` document read, and never write a per-user
  field on it: it is one shared document;
- **a page is at most 200 documents.** The store answers `limit=500` with a
  `400 VALIDATION_ERROR` ("query.limit: Input should be less than or equal to
  200") rather than trimming it, so every limit is clamped to `MAX_PAGE_LIMIT`
  in `lib/zentra.ts`. Longer walks page with `cursor` instead.

---

## Running it locally

```bash
npm install
cp .env.local.example .env.local   # then paste the key in
npm run dev                        # http://localhost:3000
```

| command | does |
| --- | --- |
| `npm run dev` | the panel on http://localhost:3000 |
| `npm run build` / `npm start` | the production build and the local server for it |
| `npm run typecheck` | `tsc --noEmit`, strict — this is what Vercel effectively checks first |
| `npm run lint` | ESLint 9 (flat config in `eslint.config.mjs`) |

A reply, a delete and an upload all touch the **live** store — there is no
sandbox. A stray `curl` against `/api/messages` posts into a real person's
thread, so try new behaviour on a `chat_*@vega.invalid` id and delete it after.

Two variables:

| name | what it is |
| --- | --- |
| `ZENTRAGRID_API_KEY` | the project-wide key the Vega app already uses. **Server-side only.** |
| `PANEL_HANDLE` | what the panel calls itself in `presence`, default `vega-team`. Lowercase. |

Never put the key in a component, in `NEXT_PUBLIC_*`, or in a commit. `.env*.local`
is gitignored.

## Deploying on Vercel

1. Push this folder to its own GitHub repository (the `.gitignore` keeps
   `.env.local` out).
2. Vercel → **Add New → Project** → import that repository. The framework is
   detected as Next.js; no build settings need changing.
3. **Settings → Environment Variables** → add `ZENTRAGRID_API_KEY` (and
   `PANEL_HANDLE` if you want something other than `vega-team`) for
   *Production*, *Preview* and *Development*.
4. Deploy. Then open the URL: the inbox should fill within a few seconds.

Redeploy after changing a variable — Vercel bakes environment variables into a
deployment. The key is never sent to the browser: check the Network tab and you
will only ever see `/api/*`.

---

## The API it exposes (and why each route exists)

| route | does |
| --- | --- |
| `GET /api/inbox` | every conversation, grouped server-side, newest activity first. `?q=` and `?unreadOnly=1` also filter server-side. |
| `GET /api/thread?chatId=` | one thread, oldest first, each message with its `read` receipt. |
| `POST /api/messages` | send a reply, or an announcement when `chatId` is `chat_broadcast`. |
| `DELETE /api/messages?id=` | delete one message (moderation). |
| `POST /api/read` | mark the user's messages read — the panel's half of the double tick. Refuses a broadcast. |
| `POST /api/upload` | multipart screenshot upload (images only, ≤10 MB). |
| `GET /api/file?id=` | streams a stored screenshot. The store serves files to nobody without the key, so `<img>` can never point at it directly. |
| `GET /api/presence` | who is online (users, and panel members). |
| `POST /api/presence` | the panel's own heartbeat. |
| `GET /api/pulse` | the four dashboard numbers. |

`lib/zentra.ts` is the only module that knows the key or the store's REST shapes;
every route is a thin wrapper over it.

## The screens

- **Inbox** — every conversation, unread pills, green dots for users who are in
  the app, a lit edge on the row, instant local search, an unread-only filter.
  Refreshes every 15 seconds.
- **Thread** — day separators, screenshots (click to enlarge), a composer with
  ⌘/Ctrl + Enter and screenshot attachments, delete on hover, one tick when a
  reply is stored and **two blue ticks** once the user has opened it. Refreshes
  every 10 seconds, and marks the user's messages read on open and on every poll.
- **Broadcast** — post and delete announcements, with a loud warning: it is one
  shared document that everyone sees.
- **Live** — who has the app open, with device and last heartbeat, one click to
  open their thread; plus the panel's own members, which is the heartbeat behind
  the app's "Online now".
- **Pulse** — threads, unread, messages in the last 24h, online now, and a ring
  that shows unread pressure as a share.

## Design notes

Dark, glassy, and deliberately cheap to run: the depth is layered gradients,
blurred light, hairline rims and a CSS-transform tilt on cards. There is **no
WebGL canvas** — it would add a dependency, a failure mode and a GPU cost to a
page whose job is reading text, and it could not be verified here. Everything
animates `transform`/`opacity` only, polled screens never animate while you type,
and `prefers-reduced-motion` stills the whole thing.

## Limitations

- **Polling, not push.** The store is REST with nothing to subscribe to, so
  "live" means 15s (inbox), 10s (thread) and 20s (presence). WhatsApp-grade
  realtime needs a socket or FCM on the phone side, which neither side has today.
- **The inbox scan is capped** at 5000 documents per request (`SCAN_LIMIT`); the
  inbox says so when it hits the ceiling. Past that, the collection wants paging
  or a per-thread query.
- **No login.** Anyone with the deployed URL can read every conversation and post
  as the team. Put it behind Vercel's password protection (Settings → Deployment
  Protection) or an SSO integration before sharing the link.
