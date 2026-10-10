'use client';

import {useCallback, useEffect, useMemo, useState} from 'react';
import type {KnownUser} from '@/lib/contract';
import {getUsers} from '@/lib/api';
import {initialsOf, relativeTime} from '@/lib/format';
import {usePoll} from '@/hooks/usePoll';
import {InboxIcon, PeopleIcon, SearchIcon} from './icons';

/**
 * The roster: every account the app has checked in for, with when they were last
 * there. Freshest first, so the people who are actually around are at the top.
 *
 * Where Live answers "who is here right now", this one answers "who is there at
 * all" — nothing is filtered by time. The source is the same `presence`
 * collection: the phone writes one heartbeat document per account and keeps
 * rewriting it, so a document is both proof the account exists and the timestamp
 * of its last visit.
 *
 * The honest caveat is in the subtitle, not buried: an account that has never run
 * the app has no document, and a real sign-up list would be the phone's own users
 * collection, which this panel has no credentials for. Saying "0 users" when
 * nobody has opened the app yet is better than implying the list is complete.
 */

type UsersViewProps = {
  onOpenChat: (chatId: string) => void;
  refreshSignal: number;
};

const UsersView = ({onOpenChat, refreshSignal}: UsersViewProps) => {
  const [search, setSearch] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [users, setUsers] = useState<KnownUser[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getUsers();
      setUsers(result.users);
      setTruncated(result.truncated);
      setError(null);
      setLoading(false);
      return result;
    } catch (failure) {
      setLoading(false);
      setError((failure as Error).message || 'Could not read the roster');
      throw failure;
    }
  }, []);

  const refresh = usePoll(() => load(), 30_000);

  useEffect(() => {
    if (refreshSignal) {
      refresh();
    }
  }, [refresh, refreshSignal]);

  const online = users.filter(user => user.online).length;

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter(user => {
      if (onlineOnly && !user.online) {
        return false;
      }
      return !needle || user.email.includes(needle);
    });
  }, [onlineOnly, search, users]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-bright/40"
          style={{
            background:
              'linear-gradient(180deg, rgba(124,77,255,0.30), rgba(124,77,255,0.10))',
          }}>
          <PeopleIcon size={18} className="text-violet-bright" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-black tracking-tight text-ink">Users</h1>
          <p className="text-xs text-ink-muted">
            {users.length} {users.length === 1 ? 'account' : 'accounts'} the app has
            checked in for · {online} in the app now · every account is listed with
            its last heartbeat
          </p>
        </div>

        <label className="flex min-w-[170px] flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 sm:flex-none">
          <SearchIcon size={15} className="shrink-0 text-ink-subtle" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Find an email…"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle sm:w-[190px]"
          />
        </label>

        <button
          type="button"
          onClick={() => setOnlineOnly(value => !value)}
          aria-pressed={onlineOnly}
          className={`focus-ring shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
            onlineOnly
              ? 'border-mint/50 bg-mint/15 text-mint'
              : 'border-white/10 bg-white/5 text-ink-muted hover:text-ink'
          }`}>
          In the app now
        </button>
      </div>

      <p className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-ink-muted">
        An account appears here the first time the app runs signed in, and the
        heartbeat it rewrites is what the &ldquo;last seen&rdquo; column reads. An
        account that has never opened the app has no row — a full sign-up list
        lives in the phone app&apos;s own users collection, which this panel has no
        credentials for.
      </p>

      {error ? (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {loading && !users.length ? (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2, 3].map(index => (
            <div key={index} className="skeleton h-[62px] rounded-xl2" />
          ))}
        </div>
      ) : null}

      {!loading && !users.length ? (
        <div className="glass flex flex-col items-center gap-2 px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-ink-subtle">
            <PeopleIcon size={22} />
          </span>
          <p className="text-sm font-semibold text-ink">Nobody has signed in yet</p>
          <p className="max-w-sm text-xs text-ink-muted">
            The app writes its first heartbeat the moment a signed-in session
            starts, so this fills in as soon as somebody opens Vega on a phone.
          </p>
        </div>
      ) : null}

      {users.length && !shown.length ? (
        <p className="glass px-4 py-6 text-center text-xs text-ink-muted">
          No account matches that.
        </p>
      ) : null}

      <ul className="space-y-2">
        {shown.map(user => (
          <Row key={user.id} user={user} onOpenChat={onOpenChat} />
        ))}
      </ul>

      {truncated ? (
        <p className="text-[11px] text-amber-200/80">
          The roster hit its scan ceiling, so older accounts may be missing.
        </p>
      ) : null}
    </div>
  );
};

const Row = ({
  user,
  onOpenChat,
}: {
  user: KnownUser;
  onOpenChat: (chatId: string) => void;
}) => (
  <li className="glass rim sheen relative flex flex-wrap items-center gap-3 overflow-hidden p-3.5">
    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-xs font-black text-violet-bright">
      {initialsOf(user.email)}
      <span
        className={`${user.online ? 'dot-online' : 'dot-idle'} absolute -bottom-0.5 -right-0.5 border-2 border-base`}
      />
    </span>

    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-bold text-ink">{user.email}</p>
      <p className="text-[11px] text-ink-muted">
        {user.online ? (
          <span className="text-mint">In the app now</span>
        ) : (
          <>Last seen {relativeTime(user.lastSeen)}</>
        )}
        {' · '}
        {new Date(user.lastSeen).toLocaleString([], {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
        {user.device ? ` · ${user.device}` : ''}
      </p>
    </div>

    <button
      type="button"
      onClick={() => onOpenChat(user.chatId)}
      aria-label={`Open the thread with ${user.email}`}
      className="focus-ring flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-ink-muted transition hover:text-ink">
      <InboxIcon size={15} />
      <span className="hidden sm:inline">Open chat</span>
    </button>
  </li>
);

export default UsersView;
