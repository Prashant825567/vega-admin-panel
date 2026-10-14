'use client';

import {useCallback, useEffect, useMemo, useState} from 'react';
import {USERS_POLL_MS, type KnownUser} from '@/lib/contract';
import {getUsers} from '@/lib/api';
import {displayNameOf, initialsOf, relativeTime} from '@/lib/format';
import {usePoll} from '@/hooks/usePoll';
import {InboxIcon, PeopleIcon, SearchIcon} from './icons';

/**
 * The roster: every account the app has checked in for, with when they were last
 * there. Freshest first, so the people who are actually around are at the top.
 *
 * Where Live answers "who is here right now", this one answers "who is there at
 * all" — nothing is filtered by time. Two sources make that true: the phone's
 * heartbeat documents, which is what puts somebody here who has signed in but
 * never written a word, and the conversations themselves, which is what keeps
 * somebody here whose heartbeat we never received. Both are folded into one row
 * per account on the server (see /api/users), because a roster with the same
 * person twice is worse than a short one.
 *
 * Rows are shown by the **name they signed in with** — the one the app asked them
 * for and keeps in its own Firestore — and that is a small decision with a real
 * one behind it: an email is an identifier, and a list of twenty addresses is not
 * a list of people. Nothing is invented when a name is missing: the address is
 * shown instead, because a name made out of an address reads like a real one and
 * then nobody can tell which rows are people. The address is one click away on
 * every row either way, and in the thread header once a conversation is open.
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
  const [namesUnavailable, setNamesUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getUsers();
      setUsers(result.users);
      setTruncated(result.truncated);
      setNamesUnavailable(result.namesUnavailable);
      setError(null);
      setLoading(false);
      return result;
    } catch (failure) {
      setLoading(false);
      setError((failure as Error).message || 'Could not read the roster');
      throw failure;
    }
  }, []);

  // The roster carries an online dot per row, so this tick is a presence tick:
  // ten seconds keeps the dots honest without re-reading Firestore as often as
  // the inbox re-reads the store (the inbox is watching a live conversation,
  // this is a list of people).
  const refresh = usePoll(() => load(), USERS_POLL_MS);

  useEffect(() => {
    if (refreshSignal) {
      refresh();
    }
  }, [refresh, refreshSignal]);

  const online = users.filter(user => user.online).length;
  const withMessages = users.filter(user => user.messages > 0).length;

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter(user => {
      if (onlineOnly && !user.online) {
        return false;
      }
      if (!needle) {
        return true;
      }
      // Either name or address finds a row: the person searching knows one and
      // not always the same one.
      return (
        user.email.includes(needle) ||
        displayNameOf(user.email, user.name).toLowerCase().includes(needle)
      );
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
            {users.length} {users.length === 1 ? 'account' : 'accounts'} have signed
            in · {online} in the app now · {withMessages} with a conversation · each
            row shows a name; click it for the email
          </p>
        </div>

        <label className="flex min-w-[170px] flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 sm:flex-none">
          <SearchIcon size={15} className="shrink-0 text-ink-subtle" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Find a name or email…"
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
        An account appears here the first time the app runs signed in, whether or
        not it has ever written to the team — that is what the heartbeat is for.
        The &ldquo;last seen&rdquo; column reads it, and a thread the account has
        started is listed with it. An account that has never opened the app has no
        row: a full sign-up list lives in the phone app&apos;s own user records,
        which this panel has no credentials for.
      </p>

      {error ? (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {namesUnavailable && users.length ? (
        <p className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-[11px] text-amber-100">
          The app&apos;s sign-in records could not be read, so every row is
          showing its address. The names themselves live in Firestore — check
          that this deployment can reach it, then refresh.
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

/**
 * One account. The name is the row; the email is behind it.
 *
 * Clicking the name reveals the address in place rather than opening anything,
 * because the question "which address is this, exactly?" is asked far more often
 * than "show me their thread" — and the thread has its own button beside it.
 */
const Row = ({
  user,
  onOpenChat,
}: {
  user: KnownUser;
  onOpenChat: (chatId: string) => void;
}) => {
  const [revealed, setRevealed] = useState(false);
  const name = displayNameOf(user.email, user.name);

  return (
    <li className="glass rim sheen relative flex flex-wrap items-center gap-3 overflow-hidden p-3.5">
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-xs font-black text-violet-bright">
        {initialsOf(user.email, user.name)}
        <span
          className={`${user.online ? 'dot-online' : 'dot-idle'} absolute -bottom-0.5 -right-0.5 border-2 border-base`}
        />
      </span>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setRevealed(value => !value)}
          aria-expanded={revealed}
          title={revealed ? 'Hide the email' : 'Show the email'}
          className="focus-ring block max-w-full truncate rounded text-left text-sm font-bold text-ink transition hover:text-violet-bright">
          {name}
        </button>
        <p className="truncate text-[11px] text-ink-muted">
          {revealed ? (
            <span className="text-violet-bright">{user.email} · </span>
          ) : null}
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
          {' · '}
          {user.messages === 0
            ? 'no messages yet'
            : `${user.messages} message${user.messages === 1 ? '' : 's'}`}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onOpenChat(user.chatId)}
        aria-label={`Open the thread with ${name}`}
        className="focus-ring flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-ink-muted transition hover:text-ink">
        <InboxIcon size={15} />
        <span className="hidden sm:inline">Open chat</span>
      </button>
    </li>
  );
};

export default UsersView;
