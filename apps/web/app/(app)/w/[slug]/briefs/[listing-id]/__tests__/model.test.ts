import type { Brief } from '@causedeck/validators';
import { describe, expect, it } from 'vitest';

import { neighbour } from '../_sheet/keyboard.ts';
import {
  SECTION_ORDER,
  isEmptyBrief,
  printTitle,
  sectionDomId,
  showStaleNote,
  visibleSections,
} from '../_sheet/model.ts';

const empty = {
  stage: null,
  last_order: [],
  obligations: { open: [], closed_count: 0 },
  carry: [],
  synopsis: null,
  last_hearing: null,
  court_notes: null,
  context: [],
  prepared: null,
} as unknown as Brief;

describe('brief sheet model (#61)', () => {
  it('lists the PR-1 sections in order and drops court notes without a payload', () => {
    expect(visibleSections(empty)).toEqual(SECTION_ORDER.filter((k) => k !== 'court_notes'));
    expect(visibleSections({ ...empty, court_notes: [] })).toEqual([...SECTION_ORDER]);
  });

  it('detects an empty brief', () => {
    expect(isEmptyBrief(empty)).toBe(true);
    expect(isEmptyBrief({ ...empty, carry: [{}] as Brief['carry'] })).toBe(false);
  });

  it('titles the printout Brief - case no. - date', () => {
    const m = { matterTitle: 'A v B', caseNo: 'WP 12/2026', matterHref: '/', listDate: null };
    expect(printTitle((v) => `Brief - ${v.caseNo} - ${v.date}`, m, '2026-10-25')).toBe(
      'Brief - WP 12/2026 - 2026-10-25',
    );
  });

  it('shows the stale note only while cleared and not re-marked', () => {
    expect(showStaleNote(true, null)).toBe(true);
    expect(showStaleNote(true, { by: null, at: '2026-10-25T00:00:00Z' })).toBe(false);
    expect(showStaleNote(false, null)).toBe(false);
  });

  it('builds dom ids and moves between sections, clamped', () => {
    expect(sectionDomId('last_order')).toBe('brief-last-order');
    expect(neighbour(['a', 'b', 'c'], null, 1)).toBe('a');
    expect(neighbour(['a', 'b', 'c'], 'c', 1)).toBe('c');
    expect(neighbour(['a', 'b', 'c'], 'b', -1)).toBe('a');
  });
});
