// Drops the per-worker clones (and the template, unless E2E_KEEP_DB=1 keeps it for debugging).
// Worker servers are stopped by their worker fixture; the `webServer` is stopped by Playwright.
import { dropE2eDatabases } from './support/db-reset.ts';

export default async function globalTeardown(): Promise<void> {
  // eslint-disable-next-line no-process-env -- harness debugging switch.
  await dropE2eDatabases({ keepTemplate: process.env.E2E_KEEP_DB === '1' });
}
