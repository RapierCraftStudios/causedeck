import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderEnvExample } from '../example.ts';
import { envRegistry } from '../schema.ts';

const committed = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..', '.env.example');

describe('.env.example', () => {
  it('renders deterministically', () => {
    expect(renderEnvExample()).toBe(renderEnvExample());
  });

  it('matches the committed file (run `pnpm env:example` after schema changes)', () => {
    expect(readFileSync(committed, 'utf8')).toBe(renderEnvExample());
  });

  it('lists every schema key with its description', () => {
    const output = renderEnvExample();

    for (const spec of envRegistry) {
      const line = spec.name.includes('*') ? spec.name.replace('*', '<NAME>') : `${spec.name}=`;
      expect(output, spec.name).toContain(line);
      expect(output, spec.name).toContain(`# ${spec.description}`);
    }
  });

  it('never writes secret values', () => {
    const output = renderEnvExample();

    for (const spec of envRegistry.filter((s) => s.secret)) {
      expect(output).toMatch(new RegExp(`^${spec.name}=$`, 'm'));
    }
  });
});
