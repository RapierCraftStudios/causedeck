// Banned (#299): the admin data layer may import `withoutWorkspace`, but no other `@causedeck/db` value.
import { db } from '@causedeck/db';

export const handle: unknown = db;
