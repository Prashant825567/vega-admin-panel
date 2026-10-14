'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {THREAD_POLL_MS, TYPING_MS, isMediaPlaceholder} from '@/lib/contract';
import type {SentAttachment} from '@/lib/contract';
import type {ThreadMessage} from '@/lib/api';
import {
  announceTyping,
  deleteMessage,
  getThread,
  hideMessage,
  markRead,
  sendBatch,
} from '@/lib/api';
import {clockTime, displayNameOf, groupByDay, initialsOf, relativeTime} from '@/lib/format';
import {usePoll} from '@/hooks/usePoll';
import Composer from './Composer';
import DeleteMenu from './DeleteMenu';
import MediaPlayer from './MediaPlayer';
import {BackIcon, CloseIcon, RefreshIcon, TicksIcon, TrashIcon} from './icons';

/**
 * One conversation, oldest first.
 *
 * Two things make this the real thing rather than a log viewer:
 *
 * - **Receipts.** A message the user wrote shows one tick once it is stored, and
 *   two blue ticks when the team has opened the thread — because opening the
 *   thread is what writes `read: true` on it. That write happens here, on the
 *   first render and again on every poll, so a message that arrives while the
 *   thread is open is acknowledged too.
 * - **Live.** The thread re-reads itself every 10 seconds, so an answer appears
 *   without a refresh, and the ticks turn blue on their own.
 *
 * Attachments come through /api/file, because the store serves files to nobody
 * without the key: a screenshot opens large, a voice note plays in its bubble and
 * a video plays there or opens up. `message.media` is what decides which — the
 * same message can be any of the three, and the wire only says which one.
 *
 * A reply can carry any number of files, so one press of Send can become several
 * messages: the words ride on the first, and each file after it lands as a bare
 * picture, voice note or video underneath. `sendBatch` reports how many of them
 * the store really took, which is what lets the composer delete the uploads that
 * nothing points at instead of leaving them stranded in the bucket.
 *
 * Deleting asks the one question that matters — **for me, or for everyone** —
 * because the two answers are different actions rather than two ways of saying
 * the same thing. "For everyone" deletes the document and both sides lose it;
 * "for me" hides it from the team's view and leaves the document, and the user,
 * completely alone. See DeleteMenu and the PATCH in /api/messages.
 *
 * The header shows the person's name; clicking it reveals their address. That is
 * the same trade the inbox makes: the thread is a conversation with somebody, and
 * their email is an identifier you sometimes need and rarely want to read first.
 */

type ThreadViewProps = {
  chatId: string;
  online: boolean;
  onBack: () => void;
  notify: (message: string, tone?: 'ok' | 'danger') => void;
  refreshSignal: number;
};

type Lightbox = {fileId: string; label: string} | null;

const Bubble = ({
  message,
  onOpenImage,
  onDelete,
}: {
  message: ThreadMessage;
  onOpenImage: (fileId: string, label: string) => void;
  onDelete: (message: ThreadMessage) => void;
}) => {
  const mine = message.from === 'team';
  return (
    <div className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`relative max-w-[min(680px,82%)] rounded-xl2 border px-3.5 py-2.5 text-sm ${
          mine
            ? 'border-violet-bright/40 bg-violet/20'
            : 'border-white/10 bg-white/[0.06]'
        }`}>
        {message.fileId && message.media === 'image' ? (
          <button
            type="button"
            onClick={() =>
              onOpenImage(message.fileId as string, message.text || 'Screenshot')
            }
            className="focus-ring mb-2 block overflow-hidden rounded-lg border border-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/file?id=${encodeURIComponent(message.fileId)}`}
              alt="Attached screenshot"
              className="max-h-64 w-auto object-cover transition hover:opacity-90"
              loading="lazy"
            />
          </button>
        ) : null}

        {message.fileId && message.media === 'audio' ? (
          <MediaPlayer
            kind="audio"
            fileId={message.fileId}
            durationMs={message.durationMs}
            bytes={message.bytes}
            className="mb-1.5"
          />
        ) : null}

        {message.fileId && message.media === 'video' ? (
          <MediaPlayer
            kind="video"
            fileId={message.fileId}
            durationMs={message.durationMs}
            bytes={message.bytes}
            className="mb-1.5"
          />
        ) : null}

        {/* A recording usually has no words of its own; the player already said
            what it is, so the label is not repeated here. */}
        {message.text && !isMediaPlaceholder(message.text) ? (
          <p className="whitespace-pre-wrap break-words leading-relaxed text-ink">
            {message.text}
          </p>
        ) : null}

        <div className="mt-1.5 flex items-center justify-end gap-1.5">
          <span className="text-[10px] text-ink-subtle">
            {clockTime(message.at)}
          </span>
          {mine ? (
            // One tick stored, two blue ones once the user has opened it.
            <TicksIcon
              size={14}
              double={message.read}
              className={message.read ? 'text-cyan' : 'text-ink-subtle'}
            />
          ) : null}
          <button
            type="button"
            aria-label={
              mine ? 'Delete this reply' : 'Delete this message from the user'
            }
            onClick={() => onDelete(message)}
            className="focus-ring ml-1 rounded p-1 text-ink-subtle opacity-0 transition hover:bg-white/10 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100">
            <TrashIcon size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};

const ThreadView = ({
  chatId,
  online,
  onBack,
  notify,
  refreshSignal,
}: ThreadViewProps) => {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [email, setEmail] = useState(chatId.replace(/^chat_/, ''));
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Lightbox>(null);
  /** The user is writing in the app's composer right now (see /api/typing). */
  const [typing, setTyping] = useState(false);
  /** When this panel last told the store it is typing, so it does not shout. */
  const typingSentAt = useRef(0);
  /** The message whose delete is being decided, if any. */
  const [deleting, setDeleting] = useState<ThreadMessage | null>(null);
  /** The header shows a name until somebody asks who this actually is. */
  const [showEmail, setShowEmail] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  // What this screen has already told the server is read, so a poll does not ask
  // for the same receipt over and over.
  const receipted = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const result = await getThread(chatId);
      setMessages(result.messages);
      setEmail(result.email);
      setName(result.name ?? null);
      setTyping(result.typing === true);
      setError(null);
      setLoading(false);
      return result;
    } catch (failure) {
      setLoading(false);
      setError((failure as Error).message || 'Could not read this thread');
      throw failure;
    }
  }, [chatId]);

  const refresh = usePoll(() => load(), THREAD_POLL_MS);

  /**
   * Tell the app we are writing back, but only now and then.
   *
   * The panel does not learn whether this worked, and does not want to: a typing
   * indicator is a courtesy, so a failure here must not put a word on the screen
   * of the person typing. Half the document's own lifetime is the interval —
   * as long as words keep coming, the app's header never blinks off between
   * them. An emptied box is the goodbye, sent straight away.
   */
  const noteTyping = useCallback(
    (draft: string) => {
      const empty = !draft.trim();
      const now = Date.now();
      if (!empty && now - typingSentAt.current < TYPING_MS / 2) {
        return;
      }
      typingSentAt.current = empty ? 0 : now;
      void announceTyping(chatId, !empty).catch(() => undefined);
    },
    [chatId],
  );

  // A new thread is a new receipt ledger.
  useEffect(() => {
    receipted.current = new Set();
    setMessages([]);
    setLoading(true);
    setError(null);
    setShowEmail(false);
  }, [chatId]);

  /** Leaving a thread is not typing in it — the app's header should say so. */
  useEffect(() => {
    return () => {
      void announceTyping(chatId, false).catch(() => undefined);
    };
  }, [chatId]);

  useEffect(() => {
    if (refreshSignal) {
      refresh();
    }
  }, [refreshSignal, refresh]);

  /**
   * The panel's half of the blue double tick: everything the user wrote that has
   * not been acknowledged yet becomes `read: true`. Announcements never reach
   * here — this screen only ever opens a user's own thread.
   */
  const acknowledge = useCallback(
    async (list: ThreadMessage[]) => {
      const fresh = list
        .filter(
          message =>
            message.from === 'user' &&
            !message.read &&
            !receipted.current.has(message.id),
        )
        .map(message => message.id);
      if (!fresh.length) {
        return;
      }
      fresh.forEach(id => receipted.current.add(id));
      try {
        await markRead(chatId, fresh);
        // The ticks were written; the next poll brings them back as read.
        await load();
      } catch {
        fresh.forEach(id => receipted.current.delete(id));
      }
    },
    [chatId, load],
  );

  useEffect(() => {
    if (messages.length) {
      void acknowledge(messages);
    }
  }, [acknowledge, messages]);

  const groups = useMemo(() => groupByDay(messages), [messages]);
  const unreadHere = messages.filter(m => m.from === 'user' && !m.read).length;

  const send = useCallback(
    async (text: string, attachments: SentAttachment[]) => {
      const claimed = await sendBatch({
        chatId,
        text,
        attachments,
        // The first message is the one allowed to throw; a later one is only
        // ever reported, so the files that did land are kept.
        onPartial: message => notify(message, 'danger'),
      });
      await load();
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
      });
      return claimed;
    },
    [chatId, load, notify],
  );

  /**
   * "For me": the message leaves this panel and nothing else.
   *
   * It is dropped from the screen immediately and re-read on the next poll, which
   * is the honest test of it: the server is what decided, not the local list.
   */
  const deleteForMe = useCallback(async () => {
    const message = deleting;
    setDeleting(null);
    if (!message) {
      return;
    }
    try {
      const result = await hideMessage(message.id, true);
      if (!result.hidden) {
        notify('The store would not hide that one', 'danger');
        return;
      }
      setMessages(current => current.filter(row => row.id !== message.id));
      notify('Hidden from the team — the user still has it', 'ok');
    } catch (failure) {
      notify((failure as Error).message || 'Could not hide that', 'danger');
    }
  }, [deleting, notify]);

  /** "For everyone": the document goes, and both sides lose it for good. */
  const deleteForEveryone = useCallback(async () => {
    const message = deleting;
    setDeleting(null);
    if (!message) {
      return;
    }
    try {
      await deleteMessage(message.id);
      setMessages(current => current.filter(row => row.id !== message.id));
      notify('Deleted for everyone', 'ok');
    } catch (failure) {
      notify((failure as Error).message || 'Could not delete that', 'danger');
    }
  }, [deleting, notify]);

  return (
    // `flex-1 min-h-0`, not `h-full`: the thread is a row of three stacked
    // pieces (header, scrolling messages, composer) that together are exactly as
    // tall as the space it was given. `min-h-0` is what lets the message list
    // *scroll* rather than stretch, and `flex-1` is what keeps the composer
    // inside the viewport when a thread runs to a thousand messages.
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
      {/* Who you are talking to, and the way back. */}
      <div className="glass sheen relative flex items-center gap-3 p-3">
        <button
          type="button"
          aria-label="Back to the inbox"
          onClick={onBack}
          className="focus-ring rounded-xl p-2 text-ink-muted transition hover:bg-white/5 hover:text-ink md:hidden">
          <BackIcon size={18} />
        </button>
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-xs font-black text-violet-bright">
          {initialsOf(email, name)}
          <span
            className={`absolute -bottom-0.5 -right-0.5 ${
              online ? 'dot-online' : 'dot-idle'
            } border-2 border-base`}
          />
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setShowEmail(value => !value)}
            aria-expanded={showEmail}
            title={showEmail ? 'Hide the email' : 'Show the email'}
            className="focus-ring block max-w-full truncate rounded text-left text-sm font-bold text-ink transition hover:text-violet-bright">
            {displayNameOf(email, name)}
          </button>
          <p className="truncate text-xs text-ink-muted">
            {showEmail ? (
              <span className="text-violet-bright">{email} · </span>
            ) : null}
            {/* Typing beats the heartbeat: one line, and the more useful fact
                is that a reply is being written. */}
            {typing
              ? 'typing…'
              : online
              ? 'In the app now'
              : 'Last heartbeat over a minute ago'}{' '}
            · {messages.length} messages
            {unreadHere > 0 ? ` · ${unreadHere} just marked read` : ''}
          </p>
        </div>
        <button
          type="button"
          aria-label="Refresh this thread"
          onClick={refresh}
          className="focus-ring rounded-xl border border-white/10 bg-white/5 p-2 text-ink-muted transition hover:text-ink">
          <RefreshIcon size={16} />
        </button>
      </div>

      {error ? (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      <div className="scroll-thin glass min-h-0 flex-1 overflow-y-auto p-4">
        {loading && !messages.length ? (
          <div className="space-y-4" aria-hidden="true">
            {[0, 1, 2].map(index => (
              <div
                key={index}
                className={`flex ${index % 2 ? 'justify-end' : 'justify-start'}`}>
                <div className="skeleton h-12 w-64 rounded-xl2" />
              </div>
            ))}
          </div>
        ) : null}

        {!loading && !messages.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm font-semibold text-ink">Nothing said yet</p>
            <p className="max-w-xs text-xs text-ink-muted">
              This thread exists but has no messages. Write the first one below.
            </p>
          </div>
        ) : null}

        <div className="space-y-5">
          {groups.map(group => (
            <div key={group.label} className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-white/10" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-subtle">
                  {group.label}
                </span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
              {group.items.map(message => (
                <Bubble
                  key={message.id}
                  message={message}
                  onOpenImage={(fileId, label) => setLightbox({fileId, label})}
                  onDelete={setDeleting}
                />
              ))}
            </div>
          ))}
        </div>
        <div ref={bottomRef} />
      </div>

      <Composer
        placeholder={`Reply to ${displayNameOf(email, name)}…`}
        onSend={send}
        onError={message => notify(message, 'danger')}
        onTyping={noteTyping}
      />

      {deleting ? (
        <DeleteMenu
          label="this message"
          onCancel={() => setDeleting(null)}
          onDeleteForMe={() => void deleteForMe()}
          onDeleteForEveryone={() => void deleteForEveryone()}
        />
      ) : null}

      {lightbox ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
          onClick={() => setLightbox(null)}>
          <div className="relative max-h-full max-w-4xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/file?id=${encodeURIComponent(lightbox.fileId)}`}
              alt={lightbox.label}
              className="max-h-[85vh] rounded-xl2 border border-white/15 object-contain"
            />
            <p className="mt-2 text-center text-xs text-ink-muted">
              {relativeTime(Date.now())} · click anywhere to close
            </p>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setLightbox(null)}
              className="focus-ring absolute -right-2 -top-2 rounded-full border border-white/15 bg-base p-1.5 text-ink">
              <CloseIcon size={16} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ThreadView;
