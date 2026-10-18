// Write the served OpenAPI 3.1 document to openapi/v1.json, or with `--check` exit 1 when the
// committed file is out of date (CI drift check). The app is built with inert deps: nothing
// connects to a database or reads secrets.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Database } from '@causedeck/db';
import { createLogger } from '@causedeck/observability';

import { createApp, OPENAPI_PATH } from '../src/app.ts';

export const OPENAPI_FILE = path.resolve(import.meta.dirname, '..', 'openapi', 'v1.json');

export async function renderOpenApi(): Promise<string> {
  const app = createApp({
    db: {} as Database,
    auth: { api: { getSession: () => Promise.resolve(null) } },
    logger: createLogger({ service: 'api', level: 'silent' }),
    allowedOrigins: ['http://localhost:3000'],
  });
  const response = await app.request(OPENAPI_PATH);
  return `${JSON.stringify(await response.json(), null, 2)}\n`;
}

/** Compared as JSON, so formatting (Prettier) of the committed file does not matter. */
export function isUpToDate(rendered: string, file: string = OPENAPI_FILE): boolean {
  let committed: string;
  try {
    committed = readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  try {
    return JSON.stringify(JSON.parse(committed)) === JSON.stringify(JSON.parse(rendered));
  } catch {
    return false;
  }
}

async function main(check: boolean): Promise<void> {
  const rendered = await renderOpenApi();
  if (!check) {
    writeFileSync(OPENAPI_FILE, rendered);
    console.log(`Wrote ${path.relative(process.cwd(), OPENAPI_FILE)}`);
    return;
  }
  if (!isUpToDate(rendered)) {
    console.error(
      'openapi/v1.json is out of date: run `pnpm --filter @causedeck/api openapi:export`',
    );
    process.exit(1);
  }
  console.log('openapi/v1.json is up to date');
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main(process.argv.includes('--check'));
}
