// The synthetic timeline matter (#41): six proceedings with an appeal chain, twelve W.M.P.
// children, one proceeding at the SR stage and exactly 80 timeline events; fictional names only,
// deterministic ids, and a unique canonical listing. A pure generator, so no database is needed.
import { describe, expect, it } from 'vitest';

import {
  SYNTHETIC_FICTIONAL_SUFFIX,
  SYNTHETIC_TIMELINE_EVENTS,
  SYNTHETIC_TIMELINE_MISC_CHILDREN,
  SYNTHETIC_TIMELINE_PROCEEDINGS,
  syntheticMatterTimeline,
  syntheticTimelineEventCount,
} from '../synthetic/index.ts';

const WS = '00000000-0000-4000-8000-000000000041';
const FORUM = '00000000-0000-4000-8000-0000000000f4';
const options = { workspaceId: WS, forumId: FORUM, today: '2026-10-22' };

describe('syntheticMatterTimeline', () => {
  const set = syntheticMatterTimeline(options);

  it('makes the six-proceeding graph with an appeal chain and twelve W.M.P. children', () => {
    const mains = set.proceedings.filter((p) => p.parentProceedingId == null);
    const children = set.proceedings.filter((p) => p.parentProceedingId != null);
    expect(mains).toHaveLength(SYNTHETIC_TIMELINE_PROCEEDINGS);
    expect(children).toHaveLength(SYNTHETIC_TIMELINE_MISC_CHILDREN);
    expect(children.every((c) => c.caseTypeRaw === 'W.M.P.' && c.kind === 'misc')).toBe(true);
    expect(mains.filter((p) => p.kind === 'appeal').map((p) => p.caseTypeRaw)).toEqual([
      'A.S.',
      'S.A.',
      'W.A.',
    ]);
    expect(set.proceedingLinks.filter((l) => l.kind === 'appeal_from')).toHaveLength(3);
    const unnumbered = mains.filter((p) => p.state === 'sr_fr');
    expect(unnumbered).toHaveLength(1);
    expect(unnumbered[0]?.number).toBeUndefined();
    expect(unnumbered[0]?.srNo).toMatch(/^SR-SYN-/);
  });

  it('makes exactly 80 timeline events', () => {
    expect(syntheticTimelineEventCount(set)).toBe(SYNTHETIC_TIMELINE_EVENTS);
    expect(set.listings).toHaveLength(16);
    expect(set.hearings).toHaveLength(10);
    expect(set.orders).toHaveLength(8);
    expect(set.stateChanges).toHaveLength(13);
    expect(set.documents).toHaveLength(22);
    expect(set.obligations).toHaveLength(8);
    expect(set.obligations.filter((o) => o.status === 'done')).toHaveLength(3);
  });

  it('keeps one canonical listing, hearings on past listings and proposed facts sourced', () => {
    expect(set.listings.filter((l) => l.canonical)).toHaveLength(1);
    const dayOf = new Map(set.listings.map((l) => [l.id, l.listDate]));
    for (const h of set.hearings) expect(dayOf.get(h.listingId)).toBe(h.heldOn);
    expect(set.hearings.some((h) => h.confirmationState === 'proposed')).toBe(true);
    for (const o of set.orders) {
      expect(set.anchors.some((a) => a.id === o.anchorId && a.documentId === o.documentId)).toBe(
        true,
      );
    }
  });

  it('writes fictional people only and no CNR', () => {
    for (const p of set.persons) expect(p.name.endsWith(SYNTHETIC_FICTIONAL_SUFFIX)).toBe(true);
    expect(set.proceedings.every((p) => p.cnr == null)).toBe(true);
  });

  it('is deterministic, and distinct per workspace', () => {
    expect(JSON.stringify(syntheticMatterTimeline(options))).toBe(JSON.stringify(set));
    const other = syntheticMatterTimeline({ ...options, workspaceId: FORUM });
    expect(other.matterId).not.toBe(set.matterId);
  });

  it('refuses a malformed day', () => {
    expect(() => syntheticMatterTimeline({ ...options, today: 'yesterday' })).toThrow(TypeError);
  });
});
