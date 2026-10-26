// PX-4: the checker only labels what an author wrote. No file under `citations/` may reach an AI
// provider or the narrative engine, or write, repair or propose a citation.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sources(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

const FORBIDDEN =
  /@causedeck\/ai|draftNarrative|narrative|gateway|bedrock|sarvam|openai|anthropic|\bllm\b|\bgenerat|\bsuggest|\bautocomplet|\bcomplet(?:e|ion)/i;

describe('citations/ makes no AI call', () => {
  const files = sources(root);

  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((f) => [path.relative(root, f), f]))(
    '%s has no AI or authoring code',
    (_n, file) => {
      expect(FORBIDDEN.exec(readFileSync(file, 'utf8'))?.[0]).toBeUndefined();
    },
  );
});
