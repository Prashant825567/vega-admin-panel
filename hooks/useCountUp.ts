'use client';

import {useEffect, useRef, useState} from 'react';

/**
 * Counts a number up to its new value, so a stat tile lands instead of blinking.
 *
 * Deliberately short (~520ms) and driven by requestAnimationFrame off a real
 * clock rather than a fixed step count, so it finishes on time whatever the
 * frame rate does. It does not run at all when the system asks for reduced
 * motion, or when the value it is given is the one already on screen.
 */
export const useCountUp = (value: number, durationMs = 520): number => {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const still =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = performance.now();
    const origin = from.current;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      // Ease out, so the last few numbers settle rather than stop dead.
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(Math.round(origin + (value - origin) * eased));
      if (progress < 1) {
        frame.current = requestAnimationFrame(step);
      } else {
        from.current = value;
      }
    };
    frame.current = requestAnimationFrame(step);

    return () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
      from.current = value;
    };
  }, [value, durationMs]);

  return shown;
};

export default useCountUp;
