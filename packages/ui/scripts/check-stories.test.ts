import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findStoryProblems, notApplicable, REQUIRED_STORIES, storyExports } from './check-stories';

const allStories = REQUIRED_STORIES.map((name) => `export const ${name}: Story = {};`).join('\n');

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function components(files: Record<string, string>): string {
  root = mkdtempSync(path.join(tmpdir(), 'check-stories-'));
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents);
  }
  return root;
}

describe('check:stories', () => {
  it('fails when a component lacks a story file', () => {
    const dir = components({ 'badge/badge.tsx': '', 'badge/badge.test.tsx': '' });
    expect(findStoryProblems(dir)).toEqual(['badge: missing badge.stories.tsx']);
  });

  it('fails when a component lacks its test or source file', () => {
    const dir = components({ 'chip/chip.stories.tsx': allStories });
    expect(findStoryProblems(dir)).toEqual([
      'chip: missing chip.tsx',
      'chip: missing chip.test.tsx',
    ]);
  });

  it('fails when shared state stories are missing', () => {
    const dir = components({
      'chip/chip.tsx': '',
      'chip/chip.test.tsx': '',
      'chip/chip.stories.tsx': 'export const Default: Story = {};',
    });
    const [problem] = findStoryProblems(dir);
    expect(problem).toContain('chip: chip.stories.tsx lacks stories Hover, FocusVisible');
    expect(problem).toContain('Tamil, Kannada');
  });

  it('accepts declared not-applicable states and ignores __fixtures__', () => {
    const dir = components({
      'chip/chip.tsx': '',
      'chip/chip.test.tsx': '',
      'chip/chip.stories.tsx': `// check-stories: n/a Loading, Invalid (static)\n${allStories
        .split('\n')
        .filter((line) => !/Loading|Invalid/.test(line))
        .join('\n')}`,
      '__fixtures__/labels.ts': '',
    });
    expect(findStoryProblems(dir)).toEqual([]);
  });

  it('passes for the real components', () => {
    expect(findStoryProblems(path.join(import.meta.dirname, '..', 'src', 'components'))).toEqual(
      [],
    );
  });

  it('parses exports and opt-outs', () => {
    expect(storyExports('export const Default = {};\nexport const meta = 1;')).toEqual(
      new Set(['Default']),
    );
    expect(notApplicable('// check-stories: n/a Hover, Active (why)')).toEqual(
      new Set(['Hover', 'Active']),
    );
  });
});
