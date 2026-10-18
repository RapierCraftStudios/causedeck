// Every component and pattern folder needs its story file (and the shared state stories).
//
//   pnpm --filter @causedeck/ui check:stories
//
// For each src/components/<name>/ this requires <name>.tsx, <name>.stories.tsx and
// <name>.test.tsx, and that the stories file exports the shared states from #8. Each
// src/patterns/<name>/ (#142) needs at least one *.stories.tsx and one *.test.tsx, with free-form
// file names (automation-level/ holds level-badge.tsx), and every stories file there exports the
// same shared states. A state that does not apply is declared in the stories file:
// `// check-stories: n/a Loading, Invalid (reason)`. Exits 1 listing every problem.
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

/** Shared state stories a stories file lacks, honouring its `n/a` declarations. */
function missingStories(source: string): string[] {
  const exported = storyExports(source);
  const skipped = notApplicable(source);
  return REQUIRED_STORIES.filter((story) => !exported.has(story) && !skipped.has(story));
}

/** Problems for the pattern folders under `patternsDir`; empty when every check passes. */
export function findPatternStoryProblems(patternsDir: string): string[] {
  if (!existsSync(patternsDir)) return [];
  const problems: string[] = [];
  const folders = readdirSync(patternsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort();

  for (const name of folders) {
    const dir = path.join(patternsDir, name);
    const files = readdirSync(dir).sort();
    const stories = files.filter((file) => file.endsWith('.stories.tsx'));
    if (stories.length === 0) problems.push(`patterns/${name}: missing stories`);
    if (!files.some((file) => file.endsWith('.test.tsx'))) {
      problems.push(`patterns/${name}: missing tests`);
    }
    for (const file of stories) {
      const missing = missingStories(readFileSync(path.join(dir, file), 'utf8'));
      if (missing.length > 0) {
        problems.push(`patterns/${name}: ${file} lacks stories ${missing.join(', ')}`);
      }
    }
  }
  return problems;
}

function main(): void {
  const src = path.join(import.meta.dirname, '..', 'src');
  const problems = [
    ...findStoryProblems(path.join(src, 'components')),
    ...findPatternStoryProblems(path.join(src, 'patterns')),
  ];
  if (problems.length > 0) {
    console.error(`check:stories failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('check:stories: every component and pattern has its stories.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
