// The matter workspace's tab manifest (#390): the layout imports it so that every tab is
// registered before `matterTabs()` runs. Each later tab adds its own `register…Tab()` call below
// (its module owns the order, label and permission), so lib/matters/tab-registry.ts never changes.
// Proceedings (#392) is registered below; People and Documents (#393) live in people-tab.ts and
// documents-tab.ts.
import { registerDocumentsTab } from './documents-tab.ts';
import { registerPeopleTab } from './people-tab.ts';
import { registerMatterTab } from './tab-registry.ts';

/** Overview (#390): every member who may read the matter. */
export function registerOverviewTab(): void {
  registerMatterTab({
    id: 'overview',
    order: 0,
    labelKey: 'overview',
    segment: '',
    visible: ({ can }) => can('matter.read'),
  });
}

/** Proceedings (#392): the tree, state changes, the proceeding form, merges and splits. */
export function registerProceedingsTab(): void {
  registerMatterTab({
    id: 'proceedings',
    order: 10,
    labelKey: 'proceedings',
    segment: 'proceedings',
    visible: ({ can }) => can('matter.read'),
  });
}

/** Register every matter tab. Idempotent: a tab registered again replaces itself (same id). */
export function registerMatterTabs(): void {
  registerOverviewTab();
  registerProceedingsTab();
  registerPeopleTab();
  registerDocumentsTab();
}

registerMatterTabs();
