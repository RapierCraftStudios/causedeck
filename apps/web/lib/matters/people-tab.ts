// The People tab of the matter workspace (#393, #40 part 5): registered from lib/matters/tabs.ts.
// Every member who may read the matter sees it; adding, editing and removing people need
// `matter.write`, decided by the page (controls absent for readers) and again by the actions.
// Pure: no core, db or React imports, like the registry.
import { registerMatterTab } from './tab-registry.ts';

/** People (#393): after Overview (0) and Proceedings (10, #392). */
export function registerPeopleTab(): void {
  registerMatterTab({
    id: 'people',
    order: 20,
    labelKey: 'people',
    segment: 'people',
    visible: ({ can }) => can('matter.read'),
  });
}
