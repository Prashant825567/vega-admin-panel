'use client';

import {useCallback, useEffect, useRef} from 'react';

/**
 * Runs something on a clock, the way a messenger does.
 *
 * ZentraGrid is REST with nothing to subscribe to, so "live" here means a short
 * poll — and this hook is the one place that decides how it behaves:
 *
 * - it fires once immediately, so a screen is never waiting for its first tick;
 * - it keeps the latest callback in a ref, so a poll never restarts a screen's
 *   state (and no stale closure ever writes over newer data);
 * - it pauses while the browser tab is hidden, because polling a tab nobody is
 *   looking at is pure load, and refreshes the moment the tab comes back;
 * - a slow call never stacks: the next tick waits for the previous one to finish.
 *
 * A failed round is swallowed on purpose. The screen keeps whatever it already
 * shows, and the next tick tries again — a dropped request must not blank out a
 * conversation that is on screen.
 */
export const usePoll = <T,>(
  task: () => Promise<T>,
  intervalMs: number,
  options: {enabled?: boolean; onResult?: (value: T) => void} = {},
): (() => void) => {
  const {enabled = true, onResult} = options;
  const taskRef = useRef(task);
  const resultRef = useRef(onResult);
  const running = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  taskRef.current = task;
  resultRef.current = onResult;

  const run = useCallback(async () => {
    if (running.current) {
      return;
    }
    running.current = true;
    try {
      const value = await taskRef.current();
      resultRef.current?.(value);
    } catch {
      // Deliberately quiet: the previous data stays on screen.
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let stopped = false;

    const schedule = () => {
      if (stopped) {
        return;
      }
      timer.current = setTimeout(async () => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          await run();
        }
        schedule();
      }, intervalMs);
    };

    void run();
    schedule();

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void run();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [enabled, intervalMs, run]);

  // A manual refresh always runs, whatever the clock is doing.
  return useCallback(() => {
    void run();
  }, [run]);
};
