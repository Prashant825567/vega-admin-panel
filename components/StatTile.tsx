'use client';

import useCountUp from '@/hooks/useCountUp';
import TiltCard from './TiltCard';
import {PulseIcon} from './icons';

/**
 * One number on the Pulse dashboard: a label, a big value that counts up, and an
 * optional accent line under it.
 *
 * The tile leans toward the pointer (TiltCard) and the number animates once, on
 * change — nothing here loops, so a dashboard left open all day stays still.
 */

type StatTileProps = {
  label: string;
  value: number;
  hint?: string;
  /** Slight variation in the accent, so the row is not four identical cards. */
  accent?: 'violet' | 'cyan' | 'mint' | 'pink';
};

const ACCENTS: Record<string, string> = {
  violet: 'rgba(167,139,250,0.9)',
  cyan: 'rgba(0,198,255,0.9)',
  mint: 'rgba(34,211,166,0.9)',
  pink: 'rgba(244,114,182,0.9)',
};

const StatTile = ({label, value, hint, accent = 'violet'}: StatTileProps) => {
  const shown = useCountUp(value);

  return (
    <TiltCard className="glass rim sheen relative overflow-hidden p-5">
      <div
        aria-hidden="true"
        className="absolute -right-10 -top-12 h-32 w-32 rounded-full"
        style={{
          background: `radial-gradient(circle, ${ACCENTS[accent]}, transparent 68%)`,
          opacity: 0.16,
          filter: 'blur(18px)',
        }}
      />
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          {label}
        </p>
        <PulseIcon size={15} className="text-ink-subtle" />
      </div>
      <p className="mt-3 text-4xl font-black tabular-nums text-ink">{shown}</p>
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
      <div
        aria-hidden="true"
        className="mt-4 h-px w-full"
        style={{
          background: `linear-gradient(90deg, ${ACCENTS[accent]}, transparent)`,
        }}
      />
    </TiltCard>
  );
};

export default StatTile;
