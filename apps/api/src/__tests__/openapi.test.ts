// `/openapi.json` is valid OpenAPI 3.1, `/docs` renders Scalar, and the committed
// openapi/v1.json matches what the app serves (drift check).
import { readFileSync } from 'node:fs';

import SwaggerParser from '@apidevtools/swagger-parser';
import { closeTestDb } from '@causedeck/db/testing';
import { afterAll, describe, expect, it } from 'vitest';

import { isUpToDate, OPENAPI_FILE, renderOpenApi } from '../../scripts/export-openapi.ts';

import { call, makeApp } from './helpers.ts';

afterAll(closeTestDb);

describe('OpenAPI', () => {
  it('serves a valid OpenAPI 3.1 document at /openapi.json', async () => {
    const response = await call(makeApp(), '/openapi.json');
    expect(response.status).toBe(200);
    const document = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(['/v1/me', '/v1/workspaces']),
    );
    // `validate` dereferences in place, so give it a copy.
    await expect(SwaggerParser.validate(structuredClone(document) as never)).resolves.toBeDefined();
  });

  it('documents errors as problem+json with a shared Problem schema', async () => {
    const document = (await (await call(makeApp(), '/openapi.json')).json()) as {
      paths: Record<
        string,
        Record<
          string,
          { responses: Record<string, { content?: Record<string, { schema: unknown }> }> }
        >
      >;
      components: { schemas: Record<string, unknown> };
    };
    expect(document.components.schemas).toHaveProperty('Problem');
    const unauthorized = document.paths['/v1/me']?.get?.responses['401'];
    expect(unauthorized?.content?.['application/problem+json']?.schema).toEqual({
      $ref: '#/components/schemas/Problem',
    });
  });

  it('renders the Scalar API reference at /docs', async () => {
    const response = await call(makeApp(), '/docs');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('/openapi.json');
    expect(html.toLowerCase()).toContain('scalar');
  });

  it('matches the committed openapi/v1.json (run `pnpm --filter @causedeck/api openapi:export`)', async () => {
    const rendered = await renderOpenApi();
    expect(isUpToDate(rendered)).toBe(true);
    expect(JSON.parse(readFileSync(OPENAPI_FILE, 'utf8'))).toEqual(JSON.parse(rendered));
  });

  it('reports drift when the committed file differs', async () => {
    const rendered = JSON.parse(await renderOpenApi()) as { info: { version: string } };
    rendered.info.version = '0.0.0-stale';
    expect(isUpToDate(JSON.stringify(rendered))).toBe(false);
    expect(isUpToDate(await renderOpenApi(), '/nonexistent/v1.json')).toBe(false);
  });
});
