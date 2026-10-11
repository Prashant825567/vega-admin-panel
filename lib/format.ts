/** Small formatting helpers shared by the screens. */

/** The clock time of a message, the way a messenger shows it. */
export const clockTime = (at: number): string =>
  new Date(at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

/** How long ago something happened, in words. */
export const relativeTime = (at: number, now = Date.now()): string => {
  if (!at) {
    return '—';
  }
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(at).toLocaleDateString();
};

/** Day separator label between messages. */
export const dayLabel = (at: number): string => {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(date, today)) {
    return 'Today';
  }
  if (same(date, yesterday)) {
    return 'Yesterday';
  }
  return date.toLocaleDateString([], {day: 'numeric', month: 'short', year: 'numeric'});
};

/**
 * What a person is called on screen.
 *
 * **Only the name they typed into the app.** The phone writes it on every
 * heartbeat, so it is what somebody chose to be called, and a panel that shows
 * anything else is putting a name on screen that nobody picked.
 *
 * When there is no name yet — an account that has not run the updated app, or a
 * heartbeat that arrived before the field existed — the address is shown as it
 * is. That is deliberately *not* the email's first half dressed up into
 * "Pr3095079": a made-up name reads like a real one, and then nobody can tell
 * which rows are people and which are guesses. The address at least says exactly
 * what it is, and it is the one thing we know for certain.
 */
export const displayNameOf = (email: string, name?: string | null): string => {
  const given = (name || '').trim();
  if (given) {
    return given;
  }
  return (email || '').trim() || 'Unknown';
};

/**
 * Letters for the little round avatar.
 *
 * A name is the natural source; with no name the address gives its first two
 * letters, as it always did. Initials are not a claim about somebody's name the
 * way a displayed one is — they are a shape to recognise a row by.
 */
export const initialsOf = (email: string, name?: string | null): string => {
  const source = (name || '').trim() || (email || '').split('@')[0] || '?';
  const parts = source.split(/[._\s-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
};

/** File size in words. */
export const fileSize = (bytes?: number): string => {
  if (!bytes || bytes < 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** Groups messages into day buckets, for the separators in a thread. */
export const groupByDay = <T extends {at: number}>(
  items: T[],
): {label: string; items: T[]}[] => {
  const groups: {label: string; items: T[]}[] = [];
  items.forEach(item => {
    const label = dayLabel(item.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(item);
    } else {
      groups.push({label, items: [item]});
    }
  });
  return groups;
};
