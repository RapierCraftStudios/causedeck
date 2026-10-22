// The matter workspace's tab manifest (#390): the layout imports it so that every tab is
// registered before `matterTabs()` runs. Each later tab adds its own `register…Tab()` call below
// (its module owns the order, label and permission), so lib/matters/tab-registry.ts never changes.
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

/** Register every matter tab. Idempotent: a tab registered again replaces itself (same id). */
export function registerMatterTabs(): void {
  registerOverviewTab();
}

registerMatterTabs();
