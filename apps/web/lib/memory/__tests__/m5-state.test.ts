import { describe, expect, it } from 'vitest';

import {
  M5_PROPOSAL_SHORTCUTS,
  lastUsedById,
  m5ScreenState,
  parseLines,
  splitProposals,
  toPlaybookCard,
  toPrecedentCard,
} from '../m5-state.ts';

describe('splitProposals', () => {
  it('routes M5 proposals away from the generic tray', () => {
    const split = splitProposals([
      { id: 'a', key: 'M5.precedent' },
      { id: 'b', key: 'M5.playbook' },
      { id: 'c', key: 'M2.brief_format' },
    ]);
    expect(split.precedents.map((p) => p.id)).toEqual(['a']);
    expect(split.playbooks.map((p) => p.id)).toEqual(['b']);
    expect(split.generic.map((p) => p.id)).toEqual(['c']);
  });
});

describe('cards', () => {
  const used = lastUsedById([
    { id: 'i1', lastUsedAt: new Date('2026-03-04T05:00:00Z') },
    { id: 'i2', lastUsedAt: null },
  ]);
  it('joins the last use and the chamber scope onto a precedent', () => {
    const card = toPrecedentCard(
      {
        itemId: 'i1',
        text: 'Prayer',
        kind: 'prayer',
        courtId: null,
        language: 'en',
        sourceDraftVersionId: 'v',
        anchorId: 'b1',
        status: 'active',
        sharedWithChamber: true,
      },
      used,
    );
    expect(card.lastUsedAt).toBe('2026-03-04T05:00:00.000Z');
    expect(card.scope).toBe('chamber');
  });
  it('is never used when the item has no usage row', () => {
    const card = toPlaybookCard(
      {
        itemId: 'zz',
        name: 'n',
        courtId: null,
        format: 'f',
        standardPrayers: [],
        annexureOrder: [],
        sharedWithChamber: false,
      },
      used,
    );
    expect(card.lastUsedAt).toBeNull();
    expect(card.scope).toBe('mine');
  });
});

describe('helpers', () => {
  it('parses one entry per non-empty line', () => {
    expect(parseLines(' a \n\n b\n')).toEqual(['a', 'b']);
  });
  it('maps the screen state', () => {
    expect(m5ScreenState({ count: 0, proposals: 0, offline: false })).toBe('empty');
    expect(m5ScreenState({ count: 0, proposals: 1, offline: false })).toBe('ready');
    expect(m5ScreenState({ count: 2, proposals: 0, offline: true })).toBe('offline');
  });
  it('binds S, E and X as the tray does', () => {
    expect(M5_PROPOSAL_SHORTCUTS).toEqual({ save: 's', edit: 'e', dismiss: 'x' });
  });
});
