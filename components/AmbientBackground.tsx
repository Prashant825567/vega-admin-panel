'use client';

/**
 * The depth behind everything: a slow gradient wash, two drifting light orbs, a
 * faint grid and a whisper of noise.
 *
 * It is built out of gradients and blurs rather than a canvas on purpose. This
 * layer sits behind the whole console, so it has to be free: no WebGL to fail,
 * nothing to lazy-load, nothing to jank while a thread scrolls. The orbs animate
 * `transform` only, and the reduced-motion rule in globals.css stills all of it
 * for anyone who asked for that.
 */

const AmbientBackground = () => (
  <div
    aria-hidden="true"
    className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
    {/* The wash: violet from the top-left, cyan from the right, both fading out. */}
    <div className="ambient-mesh absolute inset-0" />

    {/* Two lights that drift, far slower than anything on screen moves. */}
    <div
      className="animate-drift absolute h-[44rem] w-[44rem] rounded-full"
      style={{
        left: '-14%',
        top: '-20%',
        background:
          'radial-gradient(circle, rgba(124,77,255,0.40), transparent 62%)',
        filter: 'blur(70px)',
      }}
    />
    <div
      className="animate-drift-slow absolute h-[36rem] w-[36rem] rounded-full"
      style={{
        right: '-12%',
        top: '6%',
        background:
          'radial-gradient(circle, rgba(0,198,255,0.30), transparent 64%)',
        filter: 'blur(80px)',
      }}
    />
    <div
      className="animate-drift-slow absolute h-[30rem] w-[30rem] rounded-full"
      style={{
        left: '38%',
        bottom: '-16%',
        background:
          'radial-gradient(circle, rgba(167,139,250,0.26), transparent 66%)',
        filter: 'blur(90px)',
      }}
    />

    {/* Structure: a grid that fades out before it reaches the content. */}
    <div className="ambient-grid absolute inset-0 opacity-70" />

    {/* Grain, so the large flat areas are never a perfectly dead black. */}
    <div className="noise absolute inset-0 opacity-60" />

    {/* A floor line, so the console feels like it is standing on something. */}
    <div
      className="absolute inset-x-0 bottom-0 h-px"
      style={{
        background:
          'linear-gradient(90deg, transparent, rgba(167,139,250,0.35), transparent)',
      }}
    />
  </div>
);

export default AmbientBackground;
