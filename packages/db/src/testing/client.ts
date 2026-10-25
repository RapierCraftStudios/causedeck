// `@causedeck/db/testing/client` (#299): `createDb` for test child processes that run outside
// vitest (e.g. the worker shutdown fixture). `@causedeck/db/testing` imports `vitest`, which throws
// outside a vitest worker; this entry does not.
export { createDb, type CreateDbOptions, type Database } from '../client.ts';
