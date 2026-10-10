'use client';

import type {ReactElement} from 'react';
import {InboxIcon, LiveIcon, MegaphoneIcon, PeopleIcon, PulseIcon} from './icons';

/**
 * The console's way around: a slim rail on the left on a desktop, a bottom bar
 * on a phone.
 *
 * The unread count and the online count ride along on the items, so the two
 * numbers that actually mean "something needs you" are never more than a glance
 * away, whatever screen is open.
 *
 * Five is the ceiling for a bottom bar on a 320dp phone: the labels are set
 * small and given a gutter so nothing touches, and the whole row is centred
 * rather than spread.
 */

export type ViewKey = 'inbox' | 'live' | 'users' | 'broadcast' | 'pulse';

type RailProps = {
  active: ViewKey;
  onChange: (view: ViewKey) => void;
  unread: number;
  online: number;
};

const ITEMS: {
  key: ViewKey;
  label: string;
  Icon: (props: {size?: number; className?: string}) => ReactElement;
}[] = [
  {key: 'inbox', label: 'Inbox', Icon: InboxIcon},
  {key: 'live', label: 'Live', Icon: LiveIcon},
  {key: 'users', label: 'Users', Icon: PeopleIcon},
  {key: 'broadcast', label: 'Broadcast', Icon: MegaphoneIcon},
  {key: 'pulse', label: 'Pulse', Icon: PulseIcon},
];

const Rail = ({active, onChange, unread, online}: RailProps) => {
  const badgeFor = (key: ViewKey): number | null => {
    if (key === 'inbox' && unread > 0) {
      return unread;
    }
    if (key === 'live' && online > 0) {
      return online;
    }
    return null;
  };

  return (
    <>
      {/* Desktop: a vertical rail. */}
      <nav
        aria-label="Sections"
        className="glass rim sheen relative hidden w-[84px] shrink-0 flex-col items-center gap-2 py-5 md:flex">
        {ITEMS.map(({key, label, Icon}) => {
          const isActive = active === key;
          const badge = badgeFor(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-current={isActive ? 'page' : undefined}
              className={`focus-ring group relative flex w-[64px] flex-col items-center gap-1.5 rounded-2xl px-2 py-3 transition ${
                isActive
                  ? 'text-white'
                  : 'text-ink-muted hover:bg-white/5 hover:text-ink'
              }`}>
              {isActive ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-2xl border border-violet-bright/40"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(124,77,255,0.28), rgba(124,77,255,0.10))',
                    boxShadow: '0 12px 30px rgba(124,77,255,0.28)',
                  }}
                />
              ) : null}
              <span className="relative">
                <Icon size={20} />
                {badge !== null ? (
                  <span className="pill-glow absolute -right-2 -top-2 min-w-[18px] rounded-full px-1 text-center text-[10px] font-black leading-[18px] text-white">
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : null}
              </span>
              <span className="relative text-[10px] font-semibold uppercase tracking-wide">
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Mobile: the same five, along the bottom where a thumb is. */}
      <nav
        aria-label="Sections"
        className="glass sheen fixed inset-x-3 bottom-3 z-40 flex items-center justify-around py-2 md:hidden">
        {ITEMS.map(({key, label, Icon}) => {
          const isActive = active === key;
          const badge = badgeFor(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-current={isActive ? 'page' : undefined}
              className={`focus-ring relative flex min-w-[56px] flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-semibold uppercase ${
                isActive ? 'text-violet-bright' : 'text-ink-muted'
              }`}>
              <span className="relative">
                <Icon size={19} />
                {badge !== null ? (
                  <span className="pill-glow absolute -right-2.5 -top-2 min-w-[16px] rounded-full px-1 text-center text-[9px] font-black leading-4 text-white">
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : null}
              </span>
              {label}
            </button>
          );
        })}
      </nav>
    </>
  );
};

export default Rail;
