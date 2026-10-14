'use client';

import {useEffect, useState} from 'react';

/**
 * The keyboard, as the browser reports it — so the composer is never behind it.
 *
 * A phone browser has two heights. The *layout* viewport is what `100vh` (and,
 * until the keyboard opens, `100dvh`) measures, and the *visual* viewport is the
 * strip of the page a person can actually see. On Chrome for Android the layout
 * viewport shrinks with the keyboard — and `interactiveWidget: 'resizes-content'`
 * in app/layout.tsx is what makes sure of it — so `100dvh` alone is enough
 * there. iOS Safari does not shrink it: the keyboard is simply laid over the
 * page, the layout viewport stays as tall as ever, and a composer pinned to its
 * bottom sits underneath the keyboard, visible to nobody and impossible to send
 * from. That is the bug this hook exists to prevent.
 *
 * So it watches `visualViewport` and reports the strip that is really on screen:
 * `top`, `height`, and the `inset` between the two heights, which is what the
 * keyboard covers. `open` is that inset being real (a couple of pixels of jitter
 * is not a keyboard).
 *
 * It never throws and never SSR-renders a wrong height: on the server, and in a
 * browser without `visualViewport`, it reports "shut", and the shell keeps the
 * `100dvh` it would have used anyway.
 */

export type KeyboardState = {
  /** A keyboard is up, and the shell should hug the visible strip. */
  open: boolean;
  /** How much of the layout viewport it covers, in CSS pixels. */
  inset: number;
  /** Where the visible strip starts, in CSS pixels from the top of the page. */
  top: number;
  /** How tall the visible strip is. */
  height: number;
};

const SHUT: KeyboardState = {open: false, inset: 0, top: 0, height: 0};

/** Below this, a few pixels of toolbar movement are not a keyboard. */
const KEYBOARD_SLACK = 60;

export const useKeyboard = (): KeyboardState => {
  const [state, setState] = useState<KeyboardState>(SHUT);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    const sync = () => {
      const inset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      );
      const open = inset > KEYBOARD_SLACK;
      setState(current => {
        const next: KeyboardState = {
          open,
          inset: open ? Math.round(inset) : 0,
          // The strip is pinned to the top edge when nothing covers it, and the
          // browser's own scrolled-up offset is what it is when something does.
          top: open ? Math.round(viewport.offsetTop) : 0,
          height: open ? Math.round(viewport.height) : 0,
        };
        // Setting the same numbers again would re-render the whole console on
        // every scroll of a keyboard that is only being dragged around.
        return current.open === next.open &&
          current.inset === next.inset &&
          current.top === next.top &&
          current.height === next.height
          ? current
          : next;
      });
    };

    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
    };
  }, []);

  return state;
};
