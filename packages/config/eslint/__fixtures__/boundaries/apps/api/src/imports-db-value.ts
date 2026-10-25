// Banned (#299): app source value-imports `@causedeck/db`; apps go through `@causedeck/core`.
import { db } from '@causedeck/db';

export const handle: unknown = db;
