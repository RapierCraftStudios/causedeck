// Admin data layer (#309): audited reads of global tables. Pages import from here, never
// `withoutWorkspace` itself.
import { schema } from '@causedeck/db';
import { count, isNull } from 'drizzle-orm';

import { staffQuery, type StaffActor } from './scope.ts';

export { staffQuery, StaffQueryDeniedError, type StaffActor, type StaffQuery } from './scope.ts';

/** Enabled staff accounts, for the Overview page. */
export function activeStaffCount(staff: StaffActor): Promise<number> {
  return staffQuery(
    staff,
    { purpose: 'overview.staff_count', capability: 'overview', tables: ['staff_user'] },
    async (tx) => {
      const [row] = await tx
        .select({ value: count() })
        .from(schema.staffUser)
        .where(isNull(schema.staffUser.disabledAt));
      return row?.value ?? 0;
    },
  );
}
