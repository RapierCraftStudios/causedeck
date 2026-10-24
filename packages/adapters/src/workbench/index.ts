// The fixture workbench (#516, D-048): redacted fixtures from contributed documents. Exposed as
// `@causedeck/adapters/workbench` for the staff console; it reads no files and opens no connection.
import { createEchoAdapter } from '../example/echo-adapter.ts';
import { createKarnatakaHcAdapter } from '../karnataka-hc/index.ts';
import { createMadrasHcAdapter } from '../madras-hc/index.ts';
import { createNcltAdapter } from '../nclt-blr/index.ts';
import type { CourtAdapter } from '../types.ts';

export * from './build-fixture.ts';
export * from './detect.ts';
export * from './redact.ts';

/** The adapters whose fixtures the workbench can build and the regression runner covers. */
export const WORKBENCH_ADAPTERS: Readonly<Record<string, () => CourtAdapter>> = {
  echo: () => createEchoAdapter(),
  'in.ka.karnataka-hc.bengaluru': () => createKarnatakaHcAdapter(),
  'in.nclt.bengaluru': () => createNcltAdapter(),
  'in.tn.madras-hc.principal': () => createMadrasHcAdapter(),
};
