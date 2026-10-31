import { describe, expect, it } from 'vitest';

import en from '@causedeck/i18n/messages/en.json';
import {
  getNavItem,
  NAV_GROUPS,
  NAV_ITEMS,
  visibleNavItems,
  WORKSPACE_ROUTES,
} from '../lib/nav.ts';
import type { FlagKey, Role } from '../lib/workspace-context.ts';

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
  'notices',
  'portfolio',
  'activity',
  'billing',
  'invoices',
  'limitation',
  'insights',
  'settings',
];

/** Nav destinations below a route or outside the spike route map. */
const EXTRA_ITEMS = ['enquiries', 'import', 'research'];

const ids = (items: readonly { id: string }[]) => items.map((entry) => entry.id).sort();

describe('navigation manifest', () => {
  it('covers exactly the spike §8 workspace routes, once each', () => {
    expect([...WORKSPACE_ROUTES].sort()).toEqual([...SPIKE_ROUTES].sort());
    // `enquiries` is a flag-gated destination below People (`people/enquiries`), `import` the
    // bootstrap import (#567) and `research` (#896) sits outside the spike route map: none is a spike route.
    expect(ids(NAV_ITEMS)).toEqual([...WORKSPACE_ROUTES, ...EXTRA_ITEMS].sort());
    expect(new Set(NAV_ITEMS.map((entry) => entry.id)).size).toBe(NAV_ITEMS.length);
  });

  it('hides the enquiries item unless intake.enquiry_log is on and the role is an advocate', () => {
    const on = (flag: string) => flag === 'intake.enquiry_log';
    const visible = (role: Role, enabled?: (flag: FlagKey) => boolean) =>
      visibleNavItems({ role, isEnabled: enabled }).some((entry) => entry.id === 'enquiries');
    expect(visible('advocate')).toBe(false);
    expect(visible('advocate', on)).toBe(true);
    expect(visible('owner', on)).toBe(true);
    for (const role of ['junior', 'clerk', 'viewer'] as const)
      expect(visible(role, on)).toBe(false);
    expect(getNavItem('enquiries').href('demo')).toBe('/w/demo/people/enquiries');
  });

  it('builds workspace-scoped hrefs with an encoded slug', () => {
    expect(getNavItem('today').href('demo')).toBe('/w/demo/today');
    expect(getNavItem('matters').href('a b/c')).toBe('/w/a%20b%2Fc/matters');
    expect(getNavItem('settings').href('demo')).toBe('/w/demo/settings');
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
  it('marks invoices, limitation and insights as flagged, and nothing else', () => {
    expect(getNavItem('invoices').flag).toBe('invoices.enabled');
    expect(getNavItem('limitation').flag).toBe('limitation.enabled');
    expect(getNavItem('insights').flag).toBe('insights.enabled');
    expect(getNavItem('enquiries').flag).toBe('intake.enquiry_log');
    expect(NAV_ITEMS.filter((entry) => entry.flag).map((entry) => entry.id)).toEqual([
      'enquiries',
      'invoices',
      'limitation',
      'insights',
    ]);
  });

  it('hides flagged items by default (flags off)', () => {
    const visible = ids(visibleNavItems());
    expect(visible).not.toContain('invoices');
    expect(visible).not.toContain('limitation');
    expect(visible).not.toContain('insights');
    expect(visible).toHaveLength(SPIKE_ROUTES.length - 3 + 1);
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
    expect(asked.sort()).toEqual([
      'insights.enabled',
      'intake.enquiry_log',
      'invoices.enabled',
      'limitation.enabled',
    ]);
    expect(ids(visibleNavItems({ isEnabled: () => true }))).toEqual(
      [...SPIKE_ROUTES, ...EXTRA_ITEMS].sort(),
    );
    expect(ids(visibleNavItems({ isEnabled: () => false }))).toEqual(ids(visibleNavItems()));
  });
});

describe('research item', () => {
  it('sits in the work group, needs matter.read (as its page does) and is not flagged', () => {
    const research = getNavItem('research');
    expect(research.group).toBe('work');
    expect(research.requires).toBe('matter.read');
    expect(research.flag).toBeUndefined();
    expect(research.href('demo')).toBe('/w/demo/research');
    for (const role of ['owner', 'advocate', 'junior', 'clerk', 'viewer'] as const)
      expect(visibleNavItems({ role }).map((entry) => entry.id)).toContain('research');
  });
});

describe('permission-gated items', () => {
  it('hides items the role lacks permission for', () => {
    const owner = ids(visibleNavItems({ role: 'owner', isEnabled: () => true }));
    expect(owner).toEqual([...SPIKE_ROUTES, ...EXTRA_ITEMS].sort());
    const clerk = ids(visibleNavItems({ role: 'clerk', isEnabled: () => true }));
    expect(clerk).not.toContain('billing');
    expect(clerk).not.toContain('invoices');
    expect(clerk).toContain('today');
    expect(clerk).not.toContain('import');
    expect(getNavItem('import').href('demo')).toBe('/w/demo/import');
  });
});
