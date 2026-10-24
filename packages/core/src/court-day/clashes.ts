// Clash detection (#58): a member listed on the same date in different halls, or in different court
// complexes. Pure and factual: the output states the date and the halls and nothing about when items
// will be called, so no predicted time overlap can be implied (ADR 0037). Several items in the same
// hall are never a clash.
import type { Clash, ClashItem } from '@causedeck/validators';

/** A listed item with the members appearing in it. */
export interface ClashCandidate extends ClashItem {
  listDate: string;
  memberIds: readonly string[];
}

function toItem(c: ClashCandidate): ClashItem {
  return {
    listingId: c.listingId,
    proceedingId: c.proceedingId,
    forumId: c.forumId,
    hallId: c.hallId,
    itemNo: c.itemNo,
  };
}

const KIND_STATEMENT: Record<Clash['kind'], string> = {
  hall: 'Listed on the same date in different halls.',
  complex: 'Listed on the same date in different court complexes.',
};

/**
 * Every pair of listings that share a date and an appearing member but sit in different halls
 * (`hall`) or different complexes (`complex`), one clash per member and pair, in a stable order.
 */
export function detectClashes(items: readonly ClashCandidate[]): Clash[] {
  const groups = new Map<string, ClashCandidate[]>();
  for (const item of items) {
    for (const memberId of new Set(item.memberIds)) {
      const key = `${item.listDate}|${memberId}`;
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [item]);
      else group.push(item);
    }
  }
  const clashes: Clash[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const [date = '', memberId = ''] = key.split('|');
    const ordered = [...group].sort((a, b) => a.listingId.localeCompare(b.listingId));
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const a = ordered[i];
        const b = ordered[j];
        if (a === undefined || b === undefined || a.proceedingId === b.proceedingId) continue;
        const kind: Clash['kind'] | null =
          a.forumId !== b.forumId
            ? 'complex'
            : a.hallId !== null && b.hallId !== null && a.hallId !== b.hallId
              ? 'hall'
              : null;
        if (kind === null) continue;
        clashes.push({
          kind,
          date,
          memberId,
          items: [toItem(a), toItem(b)],
          statement: KIND_STATEMENT[kind],
        });
      }
    }
  }
  return clashes.sort(
    (x, y) =>
      x.date.localeCompare(y.date) ||
      x.memberId.localeCompare(y.memberId) ||
      x.items[0].listingId.localeCompare(y.items[0].listingId) ||
      x.items[1].listingId.localeCompare(y.items[1].listingId),
  );
}
