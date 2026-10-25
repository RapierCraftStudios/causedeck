// The matter workspace's tab registry (#390, #40 part 3). Each tab of `/w/[slug]/matters/[id]`
// registers itself here with its order, its label key (under `matters.workspace.tabs`), its path
// segment and a permission predicate; the layout renders the tabs the member's role may see, and
// every tab page re-checks the same permission, as the settings sub-nav does (lib/settings-nav.ts).
// Later tabs (proceedings #392, people and documents #393, timeline #41, obligations #68, memory
// #73, drafts #79) call `registerMatterTab` from their own module, listed in `lib/matters/tabs.ts`,
// never by editing this file. Pure: no core, db or React imports, so the server layout and tests
// share it. `can` is role-only (lib/workspace-context.ts); the matter-graph services re-check per
// matter.
import { can as roleCan, type Permission, type Role } from '../workspace-context.ts';

export interface MatterTabContext {
  role: Role;
  can: (permission: Permission) => boolean;
}

export interface MatterTab {
  id: string;
  /** Lower comes first; ties sort by id. */
  order: number;
  /** Message key under `matters.workspace.tabs`. */
  labelKey: string;
  /** The path under the matter: `''` for Overview, else e.g. `proceedings`. */
  segment: string;
  /** Who sees the tab; omitted means every member who can open the matter. */
  visible?: (ctx: MatterTabContext) => boolean;
}

const tabs = new Map<string, MatterTab>();

/** Register a tab; a second registration with the same id replaces the first. Returns a remover. */
export function registerMatterTab(tab: MatterTab): () => void {
  tabs.set(tab.id, tab);
  return () => {
    if (tabs.get(tab.id) === tab) tabs.delete(tab.id);
  };
}

/** The tabs `role` may see, by `order` then `id`. */
export function matterTabs(role: Role): MatterTab[] {
  const ctx: MatterTabContext = { role, can: (permission) => roleCan(role, permission) };
  return [...tabs.values()]
    .filter((tab) => tab.visible === undefined || tab.visible(ctx))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** `/w/{slug}/matters/{id}` plus the tab's segment. */
export function matterTabHref(slug: string, matterId: string, tab: Pick<MatterTab, 'segment'>) {
  const base = `/w/${encodeURIComponent(slug)}/matters/${encodeURIComponent(matterId)}`;
  return tab.segment === '' ? base : `${base}/${tab.segment}`;
}

/** Tests only: forget every registration. */
export function resetMatterTabs(): void {
  tabs.clear();
}
