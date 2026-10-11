'use client';

import {useCallback, useEffect, useState} from 'react';
import {
  BROADCAST_CHAT,
  BROADCAST_LIMIT,
  isMediaPlaceholder,
} from '@/lib/contract';
import type {SentAttachment} from '@/lib/contract';
import type {ThreadMessage} from '@/lib/api';
import {deleteMessage, getThread, sendBatch} from '@/lib/api';
import {clockTime, relativeTime} from '@/lib/format';
import {usePoll} from '@/hooks/usePoll';
import Composer from './Composer';
import MediaPlayer from './MediaPlayer';
import {MegaphoneIcon, TrashIcon} from './icons';

/**
 * Announcements: one shared thread the whole app reads.
 *
 * Three things this screen has to be loud about, because getting them wrong
 * hurts everyone at once:
 *
 * - what is written here is seen by every user, in every thread, so the warning
 *   is not decoration;
 * - it is one document with no per-user receipt, so nothing here is ever marked
 *   read — the app only marks messages inside a user's own thread;
 * - deleting removes it for everybody, which is why it asks first.
 *
 * An announcement can carry the same attachments a reply can — any number of
 * them, mixed — because "the app will be down for ten minutes" is often best said
 * out loud, and one announcement with the four screenshots that show it is kinder
 * than five announcements in a row.
 */

type BroadcastViewProps = {
  notify: (message: string, tone?: 'ok' | 'danger') => void;
  refreshSignal: number;
  /** Told to the shell so the rail can show how many are out there. */
  onCount: (count: number) => void;
};

const BroadcastView = ({notify, refreshSignal, onCount}: BroadcastViewProps) => {
  const [items, setItems] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getThread(BROADCAST_CHAT);
      // Newest first here: the panel is looking for the last thing it said.
      const list = [...result.messages].reverse();
      setItems(list);
      onCount(list.length);
      setError(null);
      setLoading(false);
      return result;
    } catch (failure) {
      setLoading(false);
      setError((failure as Error).message || 'Could not read the announcements');
      throw failure;
    }
  }, [onCount]);

  const refresh = usePoll(() => load(), 30_000);

  useEffect(() => {
    if (refreshSignal) {
      refresh();
    }
  }, [refresh, refreshSignal]);

  const post = useCallback(
    async (text: string, attachments: SentAttachment[]) => {
      const claimed = await sendBatch({
        chatId: BROADCAST_CHAT,
        text,
        attachments,
        onPartial: message => notify(message, 'danger'),
      });
      await load();
      notify('Announcement posted — everyone sees it', 'ok');
      return claimed;
    },
    [load, notify],
  );

  const remove = useCallback(
    async (item: ThreadMessage) => {
      if (
        !window.confirm(
          'Delete this announcement for everyone who has not opened the app yet?',
        )
      ) {
        return;
      }
      try {
        await deleteMessage(item.id);
        setItems(current => current.filter(row => row.id !== item.id));
        notify('Announcement deleted', 'ok');
      } catch (failure) {
        notify((failure as Error).message || 'Could not delete that', 'danger');
      }
    },
    [notify],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-bright/40"
          style={{
            background:
              'linear-gradient(180deg, rgba(124,77,255,0.30), rgba(124,77,255,0.10))',
          }}>
          <MegaphoneIcon size={18} className="text-violet-bright" />
        </span>
        <div>
          <h1 className="text-lg font-black tracking-tight text-ink">Broadcast</h1>
          <p className="text-xs text-ink-muted">
            {items.length} of the last {BROADCAST_LIMIT} announcements · shown to
            everyone in the app
          </p>
        </div>
      </div>

      <div className="rounded-xl2 border border-amber-300/30 bg-amber-300/10 px-3.5 py-2.5">
        <p className="text-xs text-amber-100">
          <strong className="font-bold">Careful:</strong> this thread is one shared
          document. Every user sees it in their own chat, it cannot be marked read
          per user, and deleting it removes it for everyone.
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {loading && !items.length
          ? [0, 1, 2].map(index => (
              <div key={index} className="skeleton h-16 rounded-xl2" />
            ))
          : null}

        {!loading && !items.length ? (
          <div className="glass flex flex-col items-center gap-2 px-6 py-12 text-center">
            <p className="text-sm font-semibold text-ink">Nothing announced yet</p>
            <p className="max-w-xs text-xs text-ink-muted">
              Anything you write below appears in every user&apos;s support chat.
            </p>
          </div>
        ) : null}

        {items.map(item => (
          <div
            key={item.id}
            className="animate-rise glass sheen relative overflow-hidden p-3.5">
            {item.fileId && item.media === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/file?id=${encodeURIComponent(item.fileId)}`}
                alt="Announcement attachment"
                className="mb-2 max-h-52 rounded-lg border border-white/10 object-cover"
                loading="lazy"
              />
            ) : null}

            {item.fileId && (item.media === 'audio' || item.media === 'video') ? (
              <MediaPlayer
                kind={item.media}
                fileId={item.fileId}
                durationMs={item.durationMs}
                bytes={item.bytes}
                className="mb-2"
              />
            ) : null}

            {item.text && !isMediaPlaceholder(item.text) ? (
              <p className="whitespace-pre-wrap break-words text-sm text-ink">
                {item.text}
              </p>
            ) : null}
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-ink-subtle">
                {relativeTime(item.at)} · {clockTime(item.at)}
              </span>
              <button
                type="button"
                onClick={() => void remove(item)}
                aria-label="Delete announcement"
                className="focus-ring rounded-lg p-1.5 text-ink-subtle transition hover:bg-white/10 hover:text-danger">
                <TrashIcon size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Composer
        placeholder="Announce something to everyone…"
        onSend={post}
        onError={message => notify(message, 'danger')}
        sendLabel="Announce"
      />
    </div>
  );
};

export default BroadcastView;
