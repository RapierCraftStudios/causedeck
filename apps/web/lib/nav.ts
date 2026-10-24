// The navigation manifest: every workspace-scoped route in the spike §8 route map. The sidebar,
// mobile nav and command palette (#155-#158) all render from this list.
import {
  Activity,
  BarChart3,
  BookOpen,
  Brain,
  CalendarDays,
  CalendarClock,
  ClipboardCheck,
  FilePen,
  Hourglass,
  Inbox,
  Landmark,
  ReceiptIndianRupee,
  Scale,
  Settings,
  Sun,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { can, type FlagKey, type Permission, type Role } from './workspace-context.ts';

/** Workspace-scoped route segments, in spike §8 order. */
export const WORKSPACE_ROUTES = [
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
  'activity',
  'billing',
  'invoices',
  'limitation',
  'insights',
  'settings',
] as const;

export type WorkspaceRoute = (typeof WORKSPACE_ROUTES)[number];

export type NavGroup = 'work' | 'followup' | 'practice' | 'settings';

export const NAV_GROUPS: readonly NavGroup[] = ['work', 'followup', 'practice', 'settings'];

export interface NavItem {
  id: WorkspaceRoute;
  labelKey: `nav.${WorkspaceRoute}`;
  icon: LucideIcon;
  href: (slug: string) => string;
  requires?: Permission;
  flag?: FlagKey;
  group: NavGroup;
  /** Count shown next to the label. Stubbed until the feature lands. */
  badge?: () => number | undefined;
}

function item(
  id: WorkspaceRoute,
  icon: LucideIcon,
  group: NavGroup,
  extra: Partial<Pick<NavItem, 'requires' | 'flag' | 'badge'>> = {},
): NavItem {
  return {
    id,
    labelKey: `nav.${id}`,
    icon,
    href: (slug) => `/w/${encodeURIComponent(slug)}/${id}`,
    group,
    ...extra,
  };
}

/** TODO: real counts arrive with the Inbox (#capture) and Obligations features. */
const noCount = () => undefined;

export const NAV_ITEMS: readonly NavItem[] = [
  item('today', Sun, 'work'),
  item('tomorrow', CalendarClock, 'work'),
  item('calendar', CalendarDays, 'work'),
  item('inbox', Inbox, 'work', { badge: noCount }),
  item('matters', Scale, 'work'),
  item('briefs', BookOpen, 'work'),
  item('obligations', ClipboardCheck, 'followup', { badge: noCount }),
  item('drafts', FilePen, 'followup'),
  item('memory', Brain, 'followup'),
  item('activity', Activity, 'followup'),
  item('people', Users, 'practice'),
  item('courts', Landmark, 'practice'),
  item('notices', BookOpen, 'practice'),
  item('billing', Wallet, 'practice', { requires: 'billing.read' }),
  item('invoices', ReceiptIndianRupee, 'practice', {
    requires: 'invoices.read',
    flag: 'invoices.enabled',
  }),
  item('limitation', Hourglass, 'practice', {
    requires: 'limitation.read',
    flag: 'limitation.enabled',
  }),
  item('insights', BarChart3, 'practice', { requires: 'insights.read' }),
  item('settings', Settings, 'settings', { requires: 'settings.read' }),
];

export function getNavItem(id: WorkspaceRoute): NavItem {
  const found = NAV_ITEMS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown nav item: ${id}`);
  return found;
}

/**
 * Every flag off: the default when no evaluator is injected. The shell injects the server-evaluated
 * `@causedeck/flags` snapshot (`FlagsProvider` / `useIsEnabled`, #22).
 */
export const flagsOff: (flag: FlagKey) => boolean = () => false;

export interface VisibleNavOptions {
  isEnabled?: ((flag: FlagKey) => boolean) | undefined;
  /** When given, items the role lacks permission for are hidden. */
  role?: Role | undefined;
}

export function isNavItemEnabled(entry: NavItem, isEnabled: (flag: FlagKey) => boolean = flagsOff) {
  return entry.flag === undefined || isEnabled(entry.flag);
}

export function visibleNavItems({ isEnabled = flagsOff, role }: VisibleNavOptions = {}): NavItem[] {
  return NAV_ITEMS.filter(
    (entry) =>
      isNavItemEnabled(entry, isEnabled) &&
      (role === undefined || entry.requires === undefined || can(role, entry.requires)),
  );
}
