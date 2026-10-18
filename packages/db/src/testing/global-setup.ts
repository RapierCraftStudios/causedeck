// Vitest `globalSetup` (runs outside the test workers, so it must not import `vitest`): one
// container and one migration run per `vitest` invocation, URLs handed to tests via `provide`.
import { startTestDatabase, type TestDatabaseUrls } from './container.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    causedeckDbUrls: TestDatabaseUrls;
  }
}

interface GlobalSetupContext {
  provide: (key: 'causedeckDbUrls', value: TestDatabaseUrls) => void;
}

export default async function globalSetup({
  provide,
}: GlobalSetupContext): Promise<() => Promise<void>> {
  const started = await startTestDatabase();
  provide('causedeckDbUrls', started.urls);
  return started.stop;
}
