// Banned (#299): app test files take values from `@causedeck/db/testing`, not the root entry.
import { schema } from '@causedeck/db';

export const tables: unknown = schema;
