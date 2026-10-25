// The end-of-day digest payload (#49; docs/product/09 §6, §8.6): "What CauseDeck did today". Pure:
// the caller (the `activity.digest` job in `@causedeck/core`) counts what the system did and what
// waits for the member; this builds what is shown. Counts only unless the member opted into names.
// Every link only opens the app (the activity feed on that day, the inbox): there is no link that
// changes anything, and the digest carries no document content, commitments or advice. It is not
// an outward message to a client or a third party.
export interface EndOfDayDigestInput {
  /** The member's local day, `YYYY-MM-DD`. */
  localDate: string;
  userId: string;
  workspaceSlug: string;
  /** L3 actions of the day that can still be undone (7 days). */
  l3Count: number;
  /** Open L2 proposals that wait for the member. */
  pendingL2Count: number;
  includeNames: boolean;
  /** Matter titles touched today; used only when `includeNames` is on. */
  matterTitles?: readonly string[];
}

export interface EndOfDayDigestPayload {
  localDate: string;
  userId: string;
  l3Count: number;
  pendingL2Count: number;
  /** App paths (the sender prefixes the app origin). */
  links: { activity: string; inbox: string };
  /** Present only when the member turned names on. */
  matterTitles?: string[];
}

const MAX_NAMES = 5;

/** The digest, or `null` for a day with no activity and nothing pending. */
export function buildEndOfDayDigest(input: EndOfDayDigestInput): EndOfDayDigestPayload | null {
  const l3Count = Math.max(0, Math.trunc(input.l3Count));
  const pendingL2Count = Math.max(0, Math.trunc(input.pendingL2Count));
  if (l3Count === 0 && pendingL2Count === 0) return null;
  const base = `/w/${encodeURIComponent(input.workspaceSlug)}`;
  const titles = input.includeNames ? (input.matterTitles ?? []).slice(0, MAX_NAMES) : [];
  return {
    localDate: input.localDate,
    userId: input.userId,
    l3Count,
    pendingL2Count,
    links: {
      activity: `${base}/activity?day=${input.localDate}`,
      inbox: `${base}/inbox`,
    },
    ...(titles.length === 0 ? {} : { matterTitles: [...titles] }),
  };
}
