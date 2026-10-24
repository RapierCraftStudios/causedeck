// The matter workspace's tab registry (#390): tabs sort by order then id, a second registration with
// the same id replaces the first, the remover forgets only its own registration, `visible`
// predicates decide per role (a tab needing `strategy.read` is hidden from clerks and viewers), the
// manifest registers Overview, Proceedings (#392), People and Documents (#393) idempotently for every role that may
// read matters, and hrefs are the
// matter path plus the tab's segment.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  matterTabHref,
  matterTabs,
  registerMatterTab,
  resetMatterTabs,
} from '../lib/matters/tab-registry.ts';
import { registerMatterTabs } from '../lib/matters/tabs.ts';

const ids = (role: Parameters<typeof matterTabs>[0]) => matterTabs(role).map((tab) => tab.id);

// tabs.ts registers its tabs on import: start every case from an empty registry.
beforeEach(() => {
  resetMatterTabs();
});

afterEach(() => {
  resetMatterTabs();
});

describe('matter tab registry (#390)', () => {
  it('sorts by order, then id', () => {
    registerMatterTab({ id: 'people', order: 30, labelKey: 'people', segment: 'people' });
    registerMatterTab({ id: 'documents', order: 30, labelKey: 'documents', segment: 'documents' });
    registerMatterTab({ id: 'overview', order: 0, labelKey: 'overview', segment: '' });
    expect(ids('owner')).toEqual(['overview', 'documents', 'people']);
  });

  it('replaces a tab registered again with the same id; the remover forgets only its own', () => {
    const removeFirst = registerMatterTab({ id: 'x', order: 5, labelKey: 'a', segment: 'a' });
    registerMatterTab({ id: 'x', order: 1, labelKey: 'b', segment: 'b' });
    expect(matterTabs('owner')).toEqual([{ id: 'x', order: 1, labelKey: 'b', segment: 'b' }]);
    removeFirst();
    expect(ids('owner')).toEqual(['x']);
    const removeSecond = registerMatterTab({ id: 'y', order: 2, labelKey: 'y', segment: 'y' });
    removeSecond();
    expect(ids('owner')).toEqual(['x']);
  });

  it('applies the permission predicate per role', () => {
    registerMatterTab({
      id: 'memory',
      order: 50,
      labelKey: 'memory',
      segment: 'memory',
      visible: ({ can }) => can('strategy.read'),
    });
    registerMatterTab({
      id: 'owners-only',
      order: 60,
      labelKey: 'x',
      segment: 'x',
      visible: ({ role }) => role === 'owner',
    });
    expect(ids('owner')).toEqual(['memory', 'owners-only']);
    expect(ids('junior')).toEqual(['memory']);
    expect(ids('clerk')).toEqual([]);
    expect(ids('viewer')).toEqual([]);
  });

  it('registers Overview, Proceedings, Timeline, People and Documents from the manifest, idempotently, for every role that reads matters', () => {
    registerMatterTabs();
    registerMatterTabs();
    for (const role of ['owner', 'advocate', 'junior', 'clerk', 'viewer'] as const) {
      expect(ids(role)).toEqual(['overview', 'proceedings', 'timeline', 'people', 'documents']);
    }
    expect(matterTabs('viewer')[0]).toMatchObject({ labelKey: 'overview', segment: '' });
    expect(matterTabs('viewer')[1]).toMatchObject({
      labelKey: 'proceedings',
      segment: 'proceedings',
    });
  });

  it('builds hrefs from the matter path and the segment', () => {
    expect(matterTabHref('demo', 'm-1', { segment: '' })).toBe('/w/demo/matters/m-1');
    expect(matterTabHref('my ws', 'm-1', { segment: 'proceedings' })).toBe(
      '/w/my%20ws/matters/m-1/proceedings',
    );
  });
});
