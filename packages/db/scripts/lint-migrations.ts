// `pnpm db:check` (part 2): every migration carries a completed review header, and DROP TABLE /
// DROP COLUMN only appears with `-- contract:approved`. With `--stamp` (run by `db:generate`), new
// migrations without a header get the placeholder header first, which fails until reviewed.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MIGRATIONS_FOLDER } from '../src/migrate.ts';
import { hasReviewHeader, lintMigrationSql, reviewHeader } from '../src/migration-lint.ts';

const folder = process.argv.includes('--dir')
  ? path.resolve(process.argv[process.argv.indexOf('--dir') + 1] ?? '.')
  : MIGRATIONS_FOLDER;
const stamp = process.argv.includes('--stamp');

const files = readdirSync(folder)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (stamp) {
  for (const file of files) {
    const full = path.join(folder, file);
    const text = readFileSync(full, 'utf8');
    if (hasReviewHeader(text)) continue;
    writeFileSync(full, reviewHeader(file.replace(/\.sql$/, '')) + text);
    console.log(`Stamped ${file}: review it, then replace <unreviewed> with your name.`);
  }
} else {
  const issues = files.flatMap((file) =>
    lintMigrationSql(file, readFileSync(path.join(folder, file), 'utf8')),
  );
  if (issues.length > 0) {
    console.error('Migration lint failed:');
    for (const issue of issues)
      console.error(`  ${issue.file}:${String(issue.line)} ${issue.message}`);
    process.exit(1);
  }
  console.log(`Migration lint: ${String(files.length)} file(s) OK.`);
}
