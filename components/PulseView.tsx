'use client';

import {useState} from 'react';
import {PULSE_POLL_MS, type Pulse} from '@/lib/contract';
import {getPulse} from '@/lib/api';
import {usePoll} from '@/hooks/usePoll';
import StatTile from './StatTile';

/**
 * The dashboard: four numbers and one gauge, in one glance.
 *
 * The gauge is "unread pressure" — how much of the conversation volume is still
 * waiting on a human. It is a share, not a count, so a quiet week and a busy week
 * both read correctly: three unread out of three threads is a full ring, three out
 * of sixty is a sliver.
 *
 * Every number here comes from /api/pulse, which reads the same grouping the
 * inbox does — so the tiles and the inbox can never tell different stories.
 */

type PulseViewProps = {
  /** From the presence poll the shell already runs. */
  online: number;
};

const Ring = ({unread, threads}: {unread: number; threads: number}) => {
  const size = 190;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // Pressure, not volume: what share of the threads is still unread.
  const ratio = threads > 0 ? Math.min(1, unread / Math.max(threads, 1)) : 0;
  const offset = circumference * (1 - ratio);

  return (
    <div className="glass rim sheen relative flex flex-col items-center justify-center p-6">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${unread} unread across ${threads} threads`}>
        <defs>
          <linearGradient id="pulse-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#A78BFA" />
            <stop offset="60%" stopColor="#7C4DFF" />
            <stop offset="100%" stopColor="#00C6FF" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#pulse-ring)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{transition: 'stroke-dashoffset 620ms cubic-bezier(0.22,1,0.36,1)'}}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-black tabular-nums text-ink">{unread}</span>
        <span className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">
          waiting
        </span>
      </div>
      <p className="mt-3 text-center text-xs text-ink-muted">
        {threads > 0
          ? `${Math.round(ratio * 100)}% of ${threads} threads still unread`
          : 'No threads yet'}
      </p>
    </div>
  );
};

const PulseView = ({online}: PulseViewProps) => {
  const [pulse, setPulse] = useState<(Pulse & {capped: boolean}) | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Same clock as the roster: this screen exists to say what is happening in
  // the app right now, and a number that is twenty seconds old is not that.
  usePoll(() => getPulse(), PULSE_POLL_MS, {
    onResult: result => {
      setPulse(result);
      setLoaded(true);
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-black tracking-tight text-ink">Pulse</h1>
        <p className="text-xs text-ink-muted">
          {loaded
            ? 'Refreshed every 20 seconds'
            : 'Reading the store…'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Threads"
          value={pulse?.threads ?? 0}
          hint="Conversations the app has started"
          accent="violet"
        />
        <StatTile
          label="Unread"
          value={pulse?.unread ?? 0}
          hint="Waiting on the team"
          accent="pink"
        />
        <StatTile
          label="Last 24h"
          value={pulse?.last24h ?? 0}
          hint={pulse?.capped ? 'At least this many' : 'Messages in a day'}
          accent="cyan"
        />
        <StatTile
          label="Online now"
          value={online}
          hint="Fresh heartbeats in the app"
          accent="mint"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Ring unread={pulse?.unread ?? 0} threads={pulse?.threads ?? 0} />

        <div className="glass sheen relative flex flex-col justify-center gap-3 p-6">
          <h2 className="text-sm font-bold text-ink">How this is counted</h2>
          <ul className="space-y-2 text-xs leading-relaxed text-ink-muted">
            <li>
              <strong className="text-ink">Threads</strong> — one per user who has
              ever written in, grouped by their chat id.
            </li>
            <li>
              <strong className="text-ink">Unread</strong> — messages a user wrote
              that the team has not opened yet. Opening a thread marks them read,
              and that is also what turns the blue double tick on in the app.
            </li>
            <li>
              <strong className="text-ink">Online now</strong> — accounts whose
              heartbeat is inside the last minute, read from the{' '}
              <code className="rounded bg-white/10 px-1">presence</code> collection.
            </li>
            <li>
              Announcements are deliberately left out of the unread count: the
              broadcast thread is one shared document with no per-user receipt.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default PulseView;
