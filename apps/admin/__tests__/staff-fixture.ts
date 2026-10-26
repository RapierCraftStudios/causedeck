// A committed staff account for the staff console tests (#310): the app role may only read
// `staff_user`, so the row is written on the owner role, as the operator CLI does.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { createDb, schema, testDatabaseUrls } from '@causedeck/db/testing';
import { sql } from 'drizzle-orm';

export interface StaffFixture {
  userId: string;
  email: string;
  cleanup: () => Promise<void>;
}

export async function committedStaff(role: 'support' | 'ops' | 'admin'): Promise<StaffFixture> {
  const owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });
  const email = `staff-${randomUUID()}@causedeck.test`;
  const [row] = await owner
    .insert(schema.user)
    .values({ name: 'Staff', email })
    .returning({ id: schema.user.id });
  if (!row) throw new Error('user insert failed');
  await owner.insert(schema.staffUser).values({ userId: row.id, role });
  return {
    userId: row.id,
    email,
    cleanup: async () => {
      // Deleting the user cascades to staff_user.
      await owner.execute(sql`delete from "user" where id = ${row.id}`);
      await owner.$client.end();
    },
  };
}
