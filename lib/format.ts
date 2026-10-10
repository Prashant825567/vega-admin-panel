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

/** Letters for the little round avatar of a conversation. */
export const initialsOf = (email: string): string => {
  const name = (email || '').split('@')[0] || '?';
  const parts = name.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
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
