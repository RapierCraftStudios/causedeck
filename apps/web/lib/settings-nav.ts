// The settings sub-nav (#284): the eight sections from the #25 design spec, in order, plus a
// secondary group for usage, the audit log (linked from the old settings index) and support access
// (owners grant, deny and revoke support sessions, #313). Each entry names
// the policy permission it needs; the shell hides entries the role lacks and every page renders the
// permission-denied state for a direct URL, both through the same `can()`. Entries without
// `requires` are open to every member (members list and personal notification preferences, as
// before the shell).
import { can, type Permission, type Role } from './workspace-context.ts';

export const SETTINGS_SECTIONS = [
  'profile',
  'members',
  'roles',
  'notifications',
  'integrations',
  'privacy',
  'export',
  'danger',
] as const;

export const SETTINGS_EXTRAS = ['usage', 'audit', 'support', 'court-watch'] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];
export type SettingsItemId = SettingsSectionId | (typeof SETTINGS_EXTRAS)[number];

export interface SettingsNavItem {
  id: SettingsItemId;
  group: 'sections' | 'more';
  /** The permission the section needs; omitted means any member. */
  requires?: Permission;
  /** Message key under `settings.nav`. */
  labelKey: SettingsItemId;
}

const REQUIRES: Readonly<Record<SettingsItemId, Permission | undefined>> = {
  profile: 'settings.read',
  members: undefined,
  roles: 'settings.read',
  notifications: undefined,
  integrations: 'workspace.manage',
  privacy: 'workspace.manage',
  export: 'export.run',
  danger: 'workspace.delete',
  usage: 'billing.read',
  audit: 'audit.read',
  support: 'support.manage',
  'court-watch': 'matter.write',
};

export const SETTINGS_NAV: readonly SettingsNavItem[] = [
  ...SETTINGS_SECTIONS.map((id) => ({ id, group: 'sections' as const, labelKey: id })),
  ...SETTINGS_EXTRAS.map((id) => ({ id, group: 'more' as const, labelKey: id })),
].map((item) => {
  const requires = REQUIRES[item.id];
  return requires === undefined ? item : { ...item, requires };
});

export function getSettingsItem(id: SettingsItemId): SettingsNavItem {
  const found = SETTINGS_NAV.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown settings section: ${id}`);
  return found;
}

/** The section's URL for workspace `slug`. */
export function settingsHref(slug: string, id: SettingsItemId): string {
  return `/w/${encodeURIComponent(slug)}/settings/${id}`;
}

/** True when `role` may open the section (the same check the page makes). */
export function canOpenSettings(role: Role, id: SettingsItemId): boolean {
  const { requires } = getSettingsItem(id);
  return requires === undefined || can(role, requires);
}

/** The entries `role` may open, in display order. */
export function visibleSettingsItems(role: Role): SettingsNavItem[] {
  return SETTINGS_NAV.filter((item) => canOpenSettings(role, item.id));
}

/** Where `/settings` lands: the first section the role may open (profile for clerks and up). */
export function settingsLanding(role: Role): SettingsItemId {
  return visibleSettingsItems(role)[0]?.id ?? 'notifications';
}

/** The entry a `/w/<slug>/settings/<id>/...` pathname belongs to, if any. */
export function settingsItemFor(pathname: string): SettingsNavItem | undefined {
  const match = /^\/w\/[^/]+\/settings\/([^/?#]+)/.exec(pathname);
  const id = match?.[1];
  return id === undefined ? undefined : SETTINGS_NAV.find((item) => item.id === id);
}
