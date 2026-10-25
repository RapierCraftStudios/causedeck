// The committed openapi/v1.json is valid OpenAPI 3.1 and documents the public routes. DB-free.
import { readFileSync } from 'node:fs';

import SwaggerParser from '@apidevtools/swagger-parser';
import { describe, expect, it } from 'vitest';

import { OPENAPI_FILE } from '../../scripts/export-openapi.ts';

const document = JSON.parse(readFileSync(OPENAPI_FILE, 'utf8')) as {
  openapi: string;
  paths: Record<string, unknown>;
};

describe('committed openapi/v1.json', () => {
  it('passes swagger-parser validation', async () => {
    expect(document.openapi).toBe('3.1.0');
    // `validate` dereferences in place, so give it a copy.
    await expect(SwaggerParser.validate(structuredClone(document) as never)).resolves.toBeDefined();
  });

  it('documents the public routes', () => {
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/v1/cases/{cnr}',
        '/v1/causelists',
        '/v1/orders',
        '/v1/notices',
        '/v1/webhook-endpoints',
      ]),
    );
  });
});
