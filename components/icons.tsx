/**
 * The handful of icons the console needs, drawn inline.
 *
 * Deliberately not an icon package: a dozen paths are cheaper to ship than a
 * dependency, and they inherit `currentColor` so a row can tint them on hover.
 */

import type {ReactNode} from 'react';

type IconProps = {
  size?: number;
  className?: string;
};

const Svg = ({
  size = 18,
  className,
  children,
}: IconProps & {children: ReactNode}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true">
    {children}
  </svg>
);

export const InboxIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H9l-4 3.5V16a2.5 2.5 0 0 1-1-2z" />
  </Svg>
);

export const MegaphoneIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" />
    <path d="M15 8.5a5 5 0 0 1 0 7" />
  </Svg>
);

export const PulseIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 12h3.5L9 6l3 12 2.5-6H21" />
  </Svg>
);

export const LiveIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
  </Svg>
);

/** The roster: two heads, the one on the right drawn smaller. */
export const PeopleIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
    <path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19.5a5.4 5.4 0 0 0-1.6-3.8" />
  </Svg>
);

export const SearchIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-3.6-3.6" />
  </Svg>
);

export const RefreshIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 5v6h-6" />
  </Svg>
);

export const SendIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4.5 12 20 5l-4.2 15L12 14z" />
    <path d="M12 14l8-9" />
  </Svg>
);

export const ImageIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <circle cx="9" cy="10" r="1.4" />
    <path d="m5 17 4.5-4.5L13 16l2.5-2.5L20 18" />
  </Svg>
);

export const MicIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
  </Svg>
);

export const VideoIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3" y="6.5" width="12.5" height="11" rx="2.5" />
    <path d="m15.5 12 5.5-3v10l-5.5-3z" />
  </Svg>
);

/** Ends a recording — the square every recorder uses for "stop". */
export const StopIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" />
  </Svg>
);

export const PlayIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 5.5 19 12 8 18.5z" fill="currentColor" />
  </Svg>
);

export const PauseIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 5.5v13M15 5.5v13" />
  </Svg>
);

export const ExpandIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" />
  </Svg>
);

export const TrashIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 7h16M9.5 7V5.5h5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
  </Svg>
);

export const BackIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m14.5 5-7 7 7 7" />
  </Svg>
);

export const CloseIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);

export const CheckIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Svg>
);

/**
 * The receipt on a message: one tick once it is stored, two when the other side
 * has opened it — the same language WhatsApp uses.
 */
export const TicksIcon = ({
  size = 14,
  className,
  double = false,
}: IconProps & {double?: boolean}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true">
    {double ? (
      <>
        <path d="m2 13 4.5 4.5L15 8" />
        <path d="m10 17 1.5 1.5L22 8" />
      </>
    ) : (
      <path d="m4 13 4.5 4.5L19 8" />
    )}
  </svg>
);
