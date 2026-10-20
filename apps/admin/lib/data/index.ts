// Admin data layer (#309): audited reads of global tables. Pages import from here, never
// `withoutWorkspace` itself. The queries come from `@causedeck/core`, or from the package that owns
// the global table (`@causedeck/flags` for `access_mode_registry`); apps never value-import
// `@causedeck/db` (#299). This layer only scopes and audits them.
import { countActiveStaff } from '@causedeck/core/support';
import type { Database } from '@causedeck/db';
import { listAccessModeRegistry, type AccessModeRegistryEntry } from '@causedeck/flags';

import { staffQuery, type StaffActor } from './scope.ts';

export { staffQuery, StaffQueryDeniedError, type StaffActor, type StaffQuery } from './scope.ts';

/** Enabled staff accounts, for the Overview page. */
export function activeStaffCount(staff: StaffActor): Promise<number> {
  return staffQuery(
    staff,
    { purpose: 'overview.staff_count', capability: 'overview', tables: ['staff_user'] },
    (tx) => countActiveStaff(tx),
  );
}

/** Every court-adapter registry row, for the Adapters page (#312). */
export function adapterRegistry(
  staff: StaffActor,
  db?: Database,
): Promise<AccessModeRegistryEntry[]> {
  return staffQuery(
    staff,
    { purpose: 'adapters.registry', capability: 'adapters', tables: ['access_mode_registry'] },
    (tx) => listAccessModeRegistry(tx),
    db,
  );
}
