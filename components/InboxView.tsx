'use client';

import {useEffect, useMemo, useState} from 'react';
import type {Conversation} from '@/lib/contract';
import {INBOX_POLL_MS} from '@/lib/contract';
import {getInbox} from '@/lib/api';
import {initialsOf, relativeTime} from '@/lib/format';
import {usePoll} from '@/hooks/usePoll';
import TiltCard from './TiltCard';
import {InboxIcon, RefreshIcon} from './icons';

/**
 * Every conversation the app has ever started, newest activity first.
 *
 * The grouping is done on the server (lib/server/inbox.ts), so this screen holds
 * a short list of threads rather than every message ever sent — and it refreshes
 * itself every 15 seconds, so a new message from a user shows up without anyone
 * pressing anything.
 *
 * Search and the unread filter run on the list already in the browser: it is
 * small, and filtering instantly beats waiting a round trip for every keystroke.
 */

type InboxViewProps = {
  /** Handles of the users with a fresh heartbeat, for the online dots. */
  online: Set<string>;
  activeChatId: string | null;
  onOpen: (chatId: string) => void;
  query: string;
  unreadOnly: boolean;
  onToggleUnreadOnly: () => void;
  refreshSignal: number;
  /** The shell needs the total for the rail badge. */
  onTotals: (unread: number) => void;
  /**
   * Side-by-side with an open thread on a wide screen: the title row and the big
   * empty state would eat the column, so they step aside and the rows stay.
   */
  compact?: boolean;
};

const SkeletonRows = () => (
  <div className="space-y-3" aria-hidden="true">
    {[0, 1, 2, 3, 4].map(index => (
      <div key={index} className="glass-soft flex items-center gap-3 p-3">
        <div className="skeleton h-11 w-11 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-3 w-40 rounded-full" />
          <div className="skeleton h-3 w-64 rounded-full" />
        </div>
        <div className="skeleton h-3 w-12 rounded-full" />
      </div>
    ))}
  </div>
);

const InboxView = ({
  online,
  activeChatId,
  onOpen,
  query,
  unreadOnly,
  onToggleUnreadOnly,
  refreshSignal,
  onTotals,
  compact = false,
}: InboxViewProps) => {
  const [rows, setRows] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const refresh = usePoll(
    async () => {
      try {
        return await getInbox();
      } catch (failure) {
        // A failed round says so, and the list already on screen stays put.
        setLoading(false);
        setError((failure as Error).message || 'Could not read the inbox');
        throw failure;
      }
    },
    INBOX_POLL_MS,
    {
      onResult: result => {
        setRows(result.conversations);
        setTruncated(result.truncated);
        setError(null);
        setLoading(false);
        onTotals(result.conversations.reduce((sum, row) => sum + row.unread, 0));
      },
    },
  );

  useEffect(() => {
    if (refreshSignal) {
      refresh();
    }
  }, [refreshSignal, refresh]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(row => {
      if (unreadOnly && row.unread === 0) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return (
        row.email.includes(needle) || row.lastText.toLowerCase().includes(needle)
      );
    });
  }, [query, rows, unreadOnly]);

  const unreadTotal = rows.reduce((sum, row) => sum + row.unread, 0);

  if (error && !rows.length) {
    return (
      <div className="glass p-6">
        <p className="text-sm font-semibold text-danger">
          The inbox could not be read
        </p>
        <p className="mt-2 text-sm text-ink-muted">{error}</p>
        <p className="mt-3 text-xs text-ink-subtle">
          Check ZENTRAGRID_API_KEY — a wrong or missing key answers 401 — then
          press refresh.
        </p>
        <button
          type="button"
          onClick={refresh}
          className="focus-ring mt-4 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-ink hover:bg-white/10">
          <RefreshIcon size={16} /> Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-black tracking-tight text-ink">
            {compact ? 'Conversations' : 'Inbox'}
          </h1>
          <p className="text-xs text-ink-muted">
            {rows.length} {rows.length === 1 ? 'conversation' : 'conversations'}
            {unreadTotal > 0 ? ` · ${unreadTotal} unread` : ' · all caught up'}
            {truncated ? ' · older threads may be beyond the scan limit' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleUnreadOnly}
            aria-pressed={unreadOnly}
            className={`focus-ring rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              unreadOnly
                ? 'border-violet-bright/60 bg-violet/25 text-white'
                : 'border-white/10 bg-white/5 text-ink-muted hover:text-ink'
            }`}>
            Unread only
          </button>
          <button
            type="button"
            onClick={refresh}
            aria-label="Refresh the inbox"
            className="focus-ring rounded-full border border-white/10 bg-white/5 p-2 text-ink-muted transition hover:text-ink">
            <RefreshIcon size={16} />
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {loading && !rows.length ? <SkeletonRows /> : null}

      {!loading && !visible.length ? (
        <div
          className={`glass flex flex-col items-center gap-3 text-center ${
            compact ? 'px-4 py-8' : 'px-6 py-14'
          }`}>
          <span
            className="relative flex h-16 w-16 items-center justify-center rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgba(124,77,255,0.35), rgba(124,77,255,0.06) 70%)',
            }}>
            <span className="animate-ring absolute inset-0 rounded-full border border-violet-bright/40" />
            <InboxIcon size={22} className="text-violet-bright" />
          </span>
          <p className="text-sm font-semibold text-ink">
            {query || unreadOnly
              ? 'Nothing matches that'
              : 'No conversations yet'}
          </p>
          <p className="max-w-sm text-xs text-ink-muted">
            {query || unreadOnly
              ? 'Clear the search or the unread filter to see every thread.'
              : 'When somebody writes to the team from the app, their conversation lands here in a few seconds.'}
          </p>
        </div>
      ) : null}

      <ul className="space-y-3">
        {visible.map((row, index) => {
          const isOnline = online.has(row.email);
          const isActive = activeChatId === row.chatId;
          return (
            <li
              key={row.chatId}
              className="animate-rise"
              style={{animationDelay: `${Math.min(index, 8) * 26}ms`}}>
              <TiltCard max={4}>
                <button
                  type="button"
                  onClick={() => onOpen(row.chatId)}
                  className={`focus-ring group relative w-full overflow-hidden rounded-xl2 border p-3 text-left transition ${
                    isActive
                      ? 'border-violet-bright/50 bg-violet/15'
                      : 'border-white/10 bg-white/[0.04] hover:border-violet-bright/30 hover:bg-white/[0.07]'
                  }`}>
                  {/* A user who is in the app right now gets a lit left edge. */}
                  {isOnline ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-2 left-0 w-[3px] rounded-full"
                      style={{
                        background:
                          'linear-gradient(180deg, #22D3A6, rgba(34,211,166,0.15))',
                      }}
                    />
                  ) : null}

                  <div className="flex items-center gap-3">
                    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-xs font-black text-violet-bright">
                      {initialsOf(row.email)}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 ${
                          isOnline ? 'dot-online' : 'dot-idle'
                        } border-2 border-base`}
                      />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-bold text-ink">
                          {row.email}
                        </span>
                        {isOnline ? (
                          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-mint">
                            online
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
                        {row.lastFrom === 'team' ? (
                          <span className="shrink-0 rounded bg-violet/25 px-1.5 py-0.5 text-[10px] font-bold uppercase text-violet-bright">
                            you
                          </span>
                        ) : null}
                        <span className="truncate">{row.lastText}</span>
                      </span>
                    </span>

                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="text-[11px] text-ink-subtle">
                        {relativeTime(row.lastAt)}
                      </span>
                      {row.unread > 0 ? (
                        <span className="pill-glow min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-black leading-5 text-white">
                          {row.unread > 99 ? '99+' : row.unread}
                        </span>
                      ) : (
                        <span className="text-[11px] text-ink-subtle">
                          {row.total} msg{row.total === 1 ? '' : 's'}
                        </span>
                      )}
                    </span>
                  </div>
                </button>
              </TiltCard>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default InboxView;
