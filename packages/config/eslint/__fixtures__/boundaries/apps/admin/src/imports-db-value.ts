// Banned (#299): apps/admin may import `withoutWorkspace`, but no other `@causedeck/db` value.
import { db } from '@causedeck/db';

export const handle: unknown = db;
