import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readIndex, storyUrl, type IndexEntry, type StoryIndex, visualCases } from './stories';

const entry = (id: string, extra: Partial<IndexEntry> = {}): IndexEntry => ({
  id,
  title: 'Components/Button',
  name: id.split('--')[1] ?? id,
  type: 'story',
  tags: ['dev', 'test', 'autodocs'],
  ...extra,
});

const index = (...entries: IndexEntry[]): StoryIndex => ({
  v: 5,
  entries: Object.fromEntries(entries.map((e) => [e.id, e])),
});

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('visualCases', () => {
  it('screenshots every story in light and dark at 360, 768 and 1280', () => {
    const cases = visualCases(index(entry('components-button--default')));
    expect(cases.map((c) => [c.theme, c.width])).toEqual([
      ['light', 360],
      ['light', 768],
      ['light', 1280],
      ['dark', 360],
      ['dark', 768],
      ['dark', 1280],
    ]);
    expect(cases[0]).toMatchObject({
      id: 'components-button--default',
      title: 'Components/Button',
      name: 'default',
      snapshot: 'components-button--default/light-360.png',
    });
  });

  it('skips docs entries and stories tagged skip-visual', () => {
    const cases = visualCases(
      index(
        entry('components-button--docs', { type: 'docs' }),
        entry('components-spinner--live', { tags: ['skip-visual'] }),
        entry('components-badge--default'),
      ),
    );
    expect(new Set(cases.map((c) => c.id))).toEqual(new Set(['components-badge--default']));
  });

  it('gives every case a unique baseline, sorted by story id', () => {
    const cases = visualCases(
      index(entry('components-input--default'), entry('components-badge--default')),
    );
    expect(cases).toHaveLength(12);
    expect(new Set(cases.map((c) => c.snapshot)).size).toBe(12);
    expect(cases[0]?.id).toBe('components-badge--default');
  });
});

describe('storyUrl', () => {
  it('opens the story iframe with the theme global', () => {
    expect(storyUrl('components-button--with-icon', 'dark')).toBe(
      'iframe.html?id=components-button--with-icon&viewMode=story&globals=theme:dark',
    );
    expect(storyUrl('a&b', 'light')).toBe(
      'iframe.html?id=a%26b&viewMode=story&globals=theme:light',
    );
  });
});

describe('readIndex', () => {
  it('reads index.json from the Storybook build', () => {
    root = mkdtempSync(path.join(tmpdir(), 'visual-index-'));
    writeFileSync(path.join(root, 'index.json'), JSON.stringify(index(entry('x--y'))));
    expect(Object.keys(readIndex(root).entries)).toEqual(['x--y']);
  });

  it('explains how to build Storybook when index.json is missing', () => {
    root = mkdtempSync(path.join(tmpdir(), 'visual-index-'));
    expect(() => readIndex(root as string)).toThrow(/build-storybook/);
  });
});
