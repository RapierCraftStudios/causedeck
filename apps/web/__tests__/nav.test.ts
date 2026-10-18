import { describe, expect, it } from 'vitest';

import en from '@causedeck/i18n/messages/en.json';
import {
  getNavItem,
  NAV_GROUPS,
  NAV_ITEMS,
  visibleNavItems,
  WORKSPACE_ROUTES,
} from '../lib/nav.ts';
import type { FlagKey } from '../lib/workspace-context.ts';

/** Spike §8 workspace-scoped routes, written out independently of the manifest. */
const SPIKE_ROUTES = [
  'today',
  'tomorrow',
  'calendar',
  'inbox',
  'matters',
  'briefs',
  'obligations',
  'drafts',
  'memory',
  'people',
  'courts',
  'activity',
  'billing',
  'invoices',
  'limitation',
  'insights',
  'settings',
];

const ids = (items: readonly { id: string }[]) => items.map((entry) => entry.id).sort();

describe('navigation manifest', () => {
  it('covers exactly the spike §8 workspace routes, once each', () => {
    expect([...WORKSPACE_ROUTES].sort()).toEqual([...SPIKE_ROUTES].sort());
    expect(ids(NAV_ITEMS)).toEqual([...WORKSPACE_ROUTES].sort());
    expect(new Set(NAV_ITEMS.map((entry) => entry.id)).size).toBe(NAV_ITEMS.length);
  });

  it('builds workspace-scoped hrefs with an encoded slug', () => {
    expect(getNavItem('today').href('demo')).toBe('/w/demo/today');
    expect(getNavItem('matters').href('a b/c')).toBe('/w/a%20b%2Fc/matters');
    expect(getNavItem('settings').href('demo')).toBe('/w/demo/settings/profile');
  });

  it('gives every item a known group and a label key present in en.json', () => {
    for (const entry of NAV_ITEMS) {
      expect(NAV_GROUPS).toContain(entry.group);
      expect(entry.labelKey).toBe(`nav.${entry.id}`);
      expect(en.nav[entry.id]).toEqual(expect.any(String));
    }
    for (const group of NAV_GROUPS) expect(en.nav.groups[group]).toEqual(expect.any(String));
  });

  it('stubs count badges for Inbox and Obligations', () => {
    expect(getNavItem('inbox').badge).toBeTypeOf('function');
    expect(getNavItem('obligations').badge).toBeTypeOf('function');
  });
});

describe('flag-gated items', () => {
  it('marks invoices and limitation as flagged, and nothing else', () => {
    expect(getNavItem('invoices').flag).toBe('invoices.enabled');
    expect(getNavItem('limitation').flag).toBe('limitation.enabled');
    expect(NAV_ITEMS.filter((entry) => entry.flag).map((entry) => entry.id)).toEqual([
      'invoices',
      'limitation',
    ]);
  });

  it('hides flagged items by default (flags off)', () => {
    const visible = ids(visibleNavItems());
    expect(visible).not.toContain('invoices');
    expect(visible).not.toContain('limitation');
    expect(visible).toHaveLength(SPIKE_ROUTES.length - 2);
  });

  it('asks the injected isEnabled about each flag and shows only enabled ones', () => {
    const asked: FlagKey[] = [];
    const onlyInvoices = (flag: FlagKey) => {
      asked.push(flag);
      return flag === 'invoices.enabled';
    };
    const visible = ids(visibleNavItems({ isEnabled: onlyInvoices }));
    expect(visible).toContain('invoices');
    expect(visible).not.toContain('limitation');
    expect(asked.sort()).toEqual(['invoices.enabled', 'limitation.enabled']);
    expect(ids(visibleNavItems({ isEnabled: () => true }))).toEqual([...SPIKE_ROUTES].sort());
    expect(ids(visibleNavItems({ isEnabled: () => false }))).toEqual(ids(visibleNavItems()));
  });
});

describe('permission-gated items', () => {
  it('hides items the role lacks permission for', () => {
    const owner = ids(visibleNavItems({ role: 'owner', isEnabled: () => true }));
    expect(owner).toEqual([...SPIKE_ROUTES].sort());
    const clerk = ids(visibleNavItems({ role: 'clerk', isEnabled: () => true }));
    expect(clerk).not.toContain('billing');
    expect(clerk).not.toContain('invoices');
    expect(clerk).toContain('today');
  });
});
