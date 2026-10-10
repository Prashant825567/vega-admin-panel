'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

/**
 * Depth on demand: a card leans toward the pointer, and springs back when it
 * leaves.
 *
 * This is the console's only "3D", and that is deliberate — it is CSS transforms
 * on one element, so it costs nothing, works on every device, and can never
 * break the way a canvas can. It also never touches the text: only the wrapper
 * moves, and by a couple of degrees.
 *
 * Ignored on touch (where a drag means "scroll"), and ignored entirely by anyone
 * whose system asks for reduced motion.
 */

type TiltCardProps = {
  children: ReactNode;
  className?: string;
  /** How far the card leans at the corners, in degrees. */
  max?: number;
};

const TiltCard = ({children, className = '', max = 6}: TiltCardProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const still = useRef(false);
  const [tilt, setTilt] = useState({rx: 0, ry: 0, active: false});

  useEffect(() => {
    // Read once: a mid-session change of this setting is not worth a listener.
    still.current =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const onMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (still.current || event.pointerType === 'touch') {
        return;
      }
      const rect = ref.current?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) {
        return;
      }
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      setTilt({
        rx: (0.5 - py) * max * 2,
        ry: (px - 0.5) * max * 2,
        active: true,
      });
    },
    [max],
  );

  const reset = useCallback(() => setTilt({rx: 0, ry: 0, active: false}), []);

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      onPointerCancel={reset}
      className={className}
      style={{
        transform: `perspective(1000px) rotateX(${tilt.rx.toFixed(2)}deg) rotateY(${tilt.ry.toFixed(2)}deg) scale(${tilt.active ? 1.012 : 1})`,
        transformStyle: 'preserve-3d',
        transition: 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)',
        willChange: 'transform',
      }}>
      {children}
    </div>
  );
};

export default TiltCard;
