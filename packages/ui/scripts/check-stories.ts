// Every component folder needs its story file (and the shared state stories).
//
//   pnpm --filter @causedeck/ui check:stories
//
// For each src/components/<name>/ this requires <name>.tsx, <name>.stories.tsx and
// <name>.test.tsx, and that the stories file exports the shared states from #8. A state that does
// not apply is declared in the stories file: `// check-stories: n/a Loading, Invalid (reason)`.
// Exits 1 listing every problem.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Story exports every component must have unless declared not applicable. */
export const REQUIRED_STORIES = [
  'Default',
  'Hover',
  'FocusVisible',
  'Active',
  'Disabled',
  'Loading',
  'Invalid',
  'WithIcon',
  'LongText',
  'RtlNeutral',
  'Tamil',
  'Kannada',
] as const;

const NOT_APPLICABLE = /\/\/\s*check-stories:\s*n\/a\s+([A-Za-z,\s]+)/g;

/** Named exports declared as `export const Name` in a stories file. */
export function storyExports(source: string): Set<string> {
  return new Set([...source.matchAll(/export\s+const\s+([A-Z]\w*)/g)].map((m) => m[1] ?? ''));
}

/** States the stories file opts out of with a `check-stories: n/a` comment. */
export function notApplicable(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(NOT_APPLICABLE)) {
    for (const name of (match[1] ?? '').split(',')) {
      const trimmed = name.trim();
      if (trimmed) names.add(trimmed);
    }
  }
  return names;
}

/** Problems for the component folders under `componentsDir`; empty when every check passes. */
export function findStoryProblems(componentsDir: string): string[] {
  if (!existsSync(componentsDir)) return [];
  const problems: string[] = [];
  const folders = readdirSync(componentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort();

  for (const name of folders) {
    const dir = path.join(componentsDir, name);
    for (const file of [`${name}.tsx`, `${name}.test.tsx`]) {
      if (!existsSync(path.join(dir, file))) problems.push(`${name}: missing ${file}`);
    }
    const storiesFile = path.join(dir, `${name}.stories.tsx`);
    if (!existsSync(storiesFile)) {
      problems.push(`${name}: missing ${name}.stories.tsx`);
      continue;
    }
    const source = readFileSync(storiesFile, 'utf8');
    const exported = storyExports(source);
    const skipped = notApplicable(source);
    const missing = REQUIRED_STORIES.filter((story) => !exported.has(story) && !skipped.has(story));
    if (missing.length > 0) {
      problems.push(`${name}: ${name}.stories.tsx lacks stories ${missing.join(', ')}`);
    }
  }
  return problems;
}

function main(): void {
  const componentsDir = path.join(import.meta.dirname, '..', 'src', 'components');
  const problems = findStoryProblems(componentsDir);
  if (problems.length > 0) {
    console.error(`check:stories failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('check:stories: every component has its stories.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
