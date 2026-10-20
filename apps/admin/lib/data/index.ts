// Admin data layer (#309): audited reads of global tables. Pages import from here, never
// `withoutWorkspace` itself. The queries come from `@causedeck/core` (apps never value-import
// `@causedeck/db`, #299); this layer only scopes and audits them.
import { countActiveStaff } from '@causedeck/core/support';

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
