import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const docs = readFileSync(
  path.resolve(import.meta.dirname, '..', 'content', 'developers', 'api.md'),
  'utf8',
);
const spec = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../../api/openapi/v1.json'), 'utf8'),
) as { paths: Record<string, unknown> };

const PUBLIC_PATHS = [
  '/v1/cases/{cnr}',
  '/v1/causelists',
  '/v1/orders',
  '/v1/notices',
  '/v1/webhook-endpoints',
  '/v1/webhook-endpoints/{id}',
];

describe('developer docs', () => {
  it('documents every public path', () => {
    for (const p of PUBLIC_PATHS) expect(docs).toContain(p);
  });

  it('only documents paths that exist in the OpenAPI spec', () => {
    const documented = new Set(
      [...docs.matchAll(/`(?:[A-Z]+ )?(\/v1\/[^`\s]*)`/g)].map((m) => m[1]),
    );
    expect(documented.size).toBeGreaterThan(0);
    for (const p of documented) expect(Object.keys(spec.paths)).toContain(p);
  });
});
