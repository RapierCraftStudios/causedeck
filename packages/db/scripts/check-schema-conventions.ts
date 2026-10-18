// `pnpm db:check` (part 1): fail when an exported table breaks the spike §4.2 conventions.
// `--schema <module>` checks another module's tables instead (used by the tests' fixtures).
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkSchemaConventions, tablesOf } from '../src/conventions.ts';
import * as committed from '../src/schema/index.ts';

const flag = process.argv.indexOf('--schema');
const target = flag === -1 ? undefined : process.argv[flag + 1];
const schema: Record<string, unknown> =
  target === undefined
    ? committed
    : ((await import(pathToFileURL(path.resolve(target)).href)) as Record<string, unknown>);

const tables = tablesOf(schema);
const violations = checkSchemaConventions(tables);
if (violations.length > 0) {
  console.error(`Schema convention violations (${String(violations.length)}):`);
  for (const v of violations) console.error(`  - [${v.rule}] ${v.message}`);
  process.exit(1);
}
console.log(`Schema conventions: ${String(tables.length)} table(s) OK.`);
