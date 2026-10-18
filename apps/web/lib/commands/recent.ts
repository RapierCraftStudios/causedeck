// Recently run palette commands, per workspace, most recent first.
export const RECENT_LIMIT = 5;

export const recentKey = (slug: string) => `causedeck.palette.recent.${slug}`;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readRecent(slug: string): string[] {
  try {
    const value: unknown = JSON.parse(storage()?.getItem(recentKey(slug)) ?? '[]');
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string').slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function pushRecent(slug: string, id: string): string[] {
  const next = [id, ...readRecent(slug).filter((entry) => entry !== id)].slice(0, RECENT_LIMIT);
  try {
    storage()?.setItem(recentKey(slug), JSON.stringify(next));
  } catch {
    // Storage full or blocked: recents are a convenience.
  }
  return next;
}
