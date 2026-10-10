'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {THREAD_POLL_MS, MAX_MESSAGE_LENGTH, isMediaPlaceholder} from '@/lib/contract';
import type {ThreadMessage} from '@/lib/api';
import {deleteMessage, getThread, markRead, sendMessage} from '@/lib/api';
import {clockTime, groupByDay, initialsOf, relativeTime} from '@/lib/format';
import {usePoll} from '@/hooks/usePoll';
import Composer, {type SentAttachment} from './Composer';
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
          {!mine ? (
            <button
              type="button"
              aria-label="Delete this message"
              onClick={() => onDelete(message)}
              className="focus-ring ml-1 rounded p-1 text-ink-subtle opacity-0 transition hover:bg-white/10 hover:text-danger group-hover:opacity-100">
              <TrashIcon size={13} />
            </button>
          ) : null}
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Lightbox>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // What this screen has already told the server is read, so a poll does not ask
  // for the same receipt over and over.
  const receipted = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const result = await getThread(chatId);
      setMessages(result.messages);
      setEmail(result.email);
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

  // A new thread is a new receipt ledger.
  useEffect(() => {
    receipted.current = new Set();
    setMessages([]);
    setLoading(true);
    setError(null);
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
    async (text: string, attachment: SentAttachment | null) => {
      await sendMessage({
        chatId,
        text,
        fileId: attachment?.fileId ?? null,
        kind: attachment?.kind ?? null,
        mime: attachment?.mime ?? null,
        durationMs: attachment?.durationMs ?? null,
        bytes: attachment?.bytes ?? null,
      });
      await load();
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
      });
    },
    [chatId, load],
  );

  const remove = useCallback(
    async (message: ThreadMessage) => {
      if (!window.confirm('Delete this message for everyone?')) {
        return;
      }
      try {
        await deleteMessage(message.id);
        setMessages(current => current.filter(row => row.id !== message.id));
        notify('Message deleted', 'ok');
      } catch (failure) {
        notify((failure as Error).message || 'Could not delete that', 'danger');
      }
    },
    [notify],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
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
          {initialsOf(email)}
          <span
            className={`absolute -bottom-0.5 -right-0.5 ${
              online ? 'dot-online' : 'dot-idle'
            } border-2 border-base`}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">{email}</p>
          <p className="text-xs text-ink-muted">
            {online ? 'In the app now' : 'Last heartbeat over a minute ago'} ·{' '}
            {messages.length} messages
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
                  onDelete={remove}
                />
              ))}
            </div>
          ))}
        </div>
        <div ref={bottomRef} />
      </div>

      <Composer
        placeholder={`Reply to ${email}…`}
        maxLength={MAX_MESSAGE_LENGTH}
        onSend={send}
        onError={message => notify(message, 'danger')}
      />

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
