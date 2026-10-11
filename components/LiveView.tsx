'use client';

import {useState} from 'react';
import {chatIdFor} from '@/lib/contract';
import type {PresenceEntry} from '@/lib/contract';
import type {PresencePayload} from '@/lib/api';
import {displayNameOf, initialsOf, relativeTime} from '@/lib/format';
import TiltCard from './TiltCard';
import {InboxIcon, LiveIcon} from './icons';

/**
 * Who is in the app right now.
 *
 * "Online" is not a guess and not a socket: the phone rewrites one document
 * every ~20 seconds, and an account counts as online while that heartbeat is
 * inside the last minute. So this list is honest by construction — close the app
 * and a user drops off within a minute, with no ghost entries to clean up.
 *
 * The second section is the panel's own members, which is the heartbeat that
 * makes the app's chat header say "Online now". Seeing it here is also the
 * quickest way to tell that the panel side is working at all.
 *
 * Cards carry the person's **name** rather than their address, like every other
 * screen: who is in the app right now is a question about people. The address is
 * a click away on the same card.
 */

type LiveViewProps = {
  presence: PresencePayload | null;
  error: string | null;
  onOpenChat: (chatId: string) => void;
};

const Card = ({
  entry,
  action,
}: {
  entry: PresenceEntry;
  action?: React.ReactNode;
}) => {
  const [showEmail, setShowEmail] = useState(false);
  const name = displayNameOf(entry.user, entry.name);

  return (
    <TiltCard max={5} className="glass rim sheen relative overflow-hidden p-4">
      <div className="flex items-center gap-3">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-xs font-black text-violet-bright">
          {initialsOf(entry.user, entry.name)}
          <span className="dot-online absolute -bottom-0.5 -right-0.5 border-2 border-base" />
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setShowEmail(value => !value)}
            aria-expanded={showEmail}
            title={showEmail ? 'Hide the email' : 'Show the email'}
            className="focus-ring block max-w-full truncate rounded text-left text-sm font-bold text-ink transition hover:text-violet-bright">
            {name}
          </button>
          <p className="truncate text-[11px] text-ink-muted">
            {showEmail ? (
              <span className="text-violet-bright">{entry.user} · </span>
            ) : null}
            {entry.device ? `${entry.device} · ` : ''}
            beat {relativeTime(entry.lastSeen)}
          </p>
        </div>
        {action}
      </div>
    </TiltCard>
  );
};

const LiveView = ({presence, error, onOpenChat}: LiveViewProps) => {
  const users = presence?.users ?? [];
  const panel = presence?.panel ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-mint/40"
          style={{
            background:
              'linear-gradient(180deg, rgba(34,211,166,0.28), rgba(34,211,166,0.08))',
          }}>
          <LiveIcon size={18} className="text-mint" />
        </span>
        <div>
          <h1 className="text-lg font-black tracking-tight text-ink">Live</h1>
          <p className="text-xs text-ink-muted">
            {users.length} {users.length === 1 ? 'user' : 'users'} in the app now
            · online means a heartbeat inside the last{' '}
            {Math.round((presence?.windowMs ?? 60_000) / 1000)} seconds
          </p>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {!users.length ? (
        <div className="glass flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span
            className="relative flex h-16 w-16 items-center justify-center rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgba(34,211,166,0.30), rgba(34,211,166,0.04) 70%)',
            }}>
            <span className="animate-ring absolute inset-0 rounded-full border border-mint/40" />
            <LiveIcon size={22} className="text-mint" />
          </span>
          <p className="text-sm font-semibold text-ink">Nobody is in the app</p>
          <p className="max-w-sm text-xs text-ink-muted">
            The heartbeat is written while the app is in the foreground, so an
            empty list here usually just means nobody has it open. Pull the app up
            on a phone and this should fill in within about twenty seconds.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {users.map(entry => (
            <Card
              key={entry.id}
              entry={entry}
              action={
                <button
                  type="button"
                  onClick={() => onOpenChat(chatIdFor(entry.user))}
                  aria-label={`Open the thread with ${displayNameOf(entry.user, entry.name)}`}
                  className="focus-ring rounded-xl border border-white/10 bg-white/5 p-2 text-ink-muted transition hover:text-ink">
                  <InboxIcon size={15} />
                </button>
              }
            />
          ))}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-muted">
          Panel members
        </h2>
        {panel.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {panel.map(entry => (
              <Card key={entry.id} entry={entry} />
            ))}
          </div>
        ) : (
          <p className="glass px-4 py-3 text-xs text-ink-muted">
            No panel member has a fresh heartbeat, so the app is showing the team
            as away. This page writes its own heartbeat every 20 seconds — if it
            stays empty, the write is failing (check the API key) rather than the
            list being genuinely empty.
          </p>
        )}
      </div>
    </div>
  );
};

export default LiveView;
