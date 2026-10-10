# Vega Support Console

The admin side of the Vega app's support chat. It reads every conversation the
phone app has started, answers into the same thread — by typing, by **recording a
voice note**, or with a screenshot or a video — posts announcements, lists every
account that has signed in, shows who is online right now, and writes the read
receipts that turn the app's tick blue.

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
| `messages` | one document per message — `chat_id`, `from`, `to`, `text`, `sent_at`, `read`, `image`, `file_id`, and for attachments `media_kind`, `mime`, `media_ms`, `media_bytes` |
| `presence` | one heartbeat per account — `user`, `role`, `last_seen`, `device` |

The rules that keep the two sides compatible (all in `lib/contract.ts`):

- a user's thread is `chat_<their email, lowercased>`; announcements are
  `chat_broadcast`;
- a reply must look exactly like
  `{chat_id, from: "admin", to: <email>, text, sent_at: <ISO>, read: false, image, file_id}`;
- an attachment says what it is. `media_kind` is `image`, `audio` or `video`;
  `mime` is the file's own type; `media_ms` is how long a recording runs and
  `media_bytes` how much it weighed. `image` keeps its old meaning — the download
  url of a **picture** — so a voice note sets it to `null` and travels by
  `file_id` alone. `mediaKindOf()` reads all of it, and falls back for the
  messages written before any of it existed;
- a recording usually has no words, so its `text` is the label
  (`🎤 Voice note`, `🎥 Video`) — that is what the phone's list shows, and
  `isMediaPlaceholder()` is how the panel avoids printing it twice;
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
  in `lib/zentra.ts`. Longer walks page with `cursor` instead;
- **the store ignores `Range`.** It advertises `Accept-Ranges: bytes` and then
  answers a ranged request with `200` and the whole file, so `/api/file` cuts the
  byte range itself. See that route for why it matters.

How big an attachment may be, and how long a voice note may run, are the two
numbers in `lib/contract.ts` that a person can actually feel:

| kind | ceiling | how it gets there |
| --- | --- | --- |
| image | 10 MB | attached as a file |
| audio | 25 MB | **recorded live**, stopped at 5 minutes (`RECORD_LIMIT_MS`) |
| video | 50 MB | attached as a file |

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
| `POST /api/upload` | multipart upload of an image, a voice note or a video, with the recording length when the browser knows it. Refuses anything else and anything over its cap. |
| `DELETE /api/upload?id=` | removes a file again. Used when an upload succeeds and the message that was going to carry it does not, so a failed send cannot leave an orphan. |
| `GET /api/file?id=` | streams a stored file, and serves byte ranges (`206`/`416`) so a recording can be seeked. The store serves files to nobody without the key, so `<img>`/`<audio>`/`<video>` can never point at it directly. |
| `GET /api/presence` | who is online (users, and panel members). |
| `POST /api/presence` | the panel's own heartbeat. |
| `GET /api/users` | the roster: every account the app has checked in for, with its last heartbeat. |
| `GET /api/pulse` | the four dashboard numbers. |

`lib/zentra.ts` is the only module that knows the key or the store's REST shapes;
every route is a thin wrapper over it.

## The screens

- **Inbox** — every conversation, unread pills, green dots for users who are in
  the app, a lit edge on the row, instant local search, an unread-only filter.
  Refreshes every 15 seconds.
- **Thread** — day separators, screenshots (click to enlarge), voice notes and
  videos playing in their own bubble, a composer with ⌘/Ctrl + Enter, delete on
  hover, one tick when a reply is stored and **two blue ticks** once the user has
  opened it. Refreshes every 10 seconds, and marks the user's messages read on
  open and on every poll.
- **Broadcast** — post and delete announcements, with a loud warning: it is one
  shared document that everyone sees. An announcement takes the same attachments
  a reply does.
- **Live** — who has the app open, with device and last heartbeat, one click to
  open their thread; plus the panel's own members, which is the heartbeat behind
  the app's "Online now".
- **Users** — the roster: every account the app has checked in for, freshest
  first, each with its last-seen time, device and whether it is in the app now.
  Searchable, filterable to the ones that are online, and one click from any row
  into that account's thread.
- **Pulse** — threads, unread, messages in the last 24h, online now, and a ring
  that shows unread pressure as a share.

## Design notes

Dark, glassy, and deliberately cheap to run: the depth is layered gradients,
blurred light, hairline rims and a CSS-transform tilt on cards. There is **no
WebGL canvas** — it would add a dependency, a failure mode and a GPU cost to a
page whose job is reading text, and it could not be verified here. Everything
animates `transform`/`opacity` only, polled screens never animate while you type,
and `prefers-reduced-motion` stills the whole thing.

## Recording and playing back

The composer's mic button and the players in a bubble are the browser's own:
`getUserMedia` + `MediaRecorder` to record (no dependency, no server, no codec of
ours — see `lib/media.ts` and `hooks/useRecorder.ts`) and an `<audio>`/`<video>`
to play back. Both are worth knowing the shape of before changing them:

- **only the microphone is recorded.** A screenshot and a video are picked from
  disk. A screen recording is made by the operating system, and there is no reason
  to ask for somebody's webcam to talk about a playback bug;
- **the container is negotiated, not assumed.** Chrome and Firefox record WebM,
  Safari records MP4. The first type `MediaRecorder.isTypeSupported` admits to
  wins, and the recorder is told to use it, so the stored file is one a player can
  open;
- **the stream is always released** — on stop, on cancel, on an error, and on
  unmount. A microphone left open keeps the browser's recording indicator lit and
  the device busy for every other tab;
- **the recorder stops at the cap**, it does not fail at the end with "too big".
  `RECORD_LIMIT_MS` is what ends it, and the UI says so;
- **nothing uploads until Send is pressed**, so a file picked and thrown away
  leaves nothing in the store. One path uploads all three kinds, and it deletes
  the file again if the message write then fails;
- **one voice note plays at a time** — a module-level registry pauses the last
  one, which is the one behaviour every messenger has and a naive tag does not.

The mic button only appears where recording is possible at all (an https origin
or localhost); on a plain-http deployment `getUserMedia` does not exist and the
button is hidden rather than broken.

## Limitations

- **The phone app cannot send a voice note yet.** The panel reads and plays audio
  from the store, but the app has no recorder — `react-native-video` is the only
  media dependency it has. That is a native addition and a new APK build.
- **Video is uploaded, not recorded** — and it is uploaded whole, so a long screen
  recording can hit the 50 MB ceiling. There is no client-side transcoding.
- **Range support is emulated.** Because the store ignores `Range`, `/api/file`
  reads the upstream body and discards the prefix before the requested slice. A
  seek therefore costs one full read of the file from the store; memory stays at
  one chunk, but bandwidth does not.
- **The roster is the presence collection**, so an account that has never run the
  app has no row. A true sign-up list is the phone's own users collection, which
  this panel has no credentials for.
- **Polling, not push.** The store is REST with nothing to subscribe to, so
  "live" means 15s (inbox), 10s (thread) and 20s (presence). WhatsApp-grade
  realtime needs a socket or FCM on the phone side, which neither side has today.
- **The inbox scan is capped** at 5000 documents per request (`SCAN_LIMIT`); the
  inbox says so when it hits the ceiling. Past that, the collection wants paging
  or a per-thread query.
- **No login.** Anyone with the deployed URL can read every conversation and post
  as the team. Put it behind Vercel's password protection (Settings → Deployment
  Protection) or an SSO integration before sharing the link.
