// Allowed (#299): an app test file takes db values from `@causedeck/db/testing` and the seeds.
import { seedPlans } from '@causedeck/db/seed/plans';
import { testAppDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';

export const harness: unknown[] = [testAppDb, seedTwoTenants, seedPlans];
