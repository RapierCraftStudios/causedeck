#!/usr/bin/env node
// Bundle budget (spike §10): initial JS for the home route must stay <= 180 KB gzip.
// Run after `next build`: `pnpm --filter @causedeck/web bundle:budget`. For a visual breakdown use
// `pnpm --filter @causedeck/web analyze` (@next/bundle-analyzer).
//
// "Initial JS" = the framework root chunks (build-manifest `rootMainFiles`) plus every client chunk
// the `/page` route can load on first render: layout, page and the root error/loading/not-found
// boundaries (client reference manifest `entryJSFiles`). Each chunk counts once.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const BUDGET_BYTES = 180 * 1024;

/** Unique `.js` chunk paths (relative to `.next/`) the home route loads initially. */
export function initialChunks(buildManifest, clientReferenceManifest) {
  const files = [
    ...(buildManifest.rootMainFiles ?? []),
    ...Object.values(clientReferenceManifest.entryJSFiles ?? {}).flat(),
  ];
  return [...new Set(files.map((file) => file.replace(/^\/?_next\//, '').replace(/^\//, '')))]
    .filter((file) => file.endsWith('.js'))
    .sort();
}

/** Sum gzip sizes and compare with the budget. */
export function evaluateBudget(sizes, budget = BUDGET_BYTES) {
  const total = sizes.reduce((sum, entry) => sum + entry.gzipBytes, 0);
  return { total, budget, ok: total <= budget };
}

/** `globalThis.__RSC_MANIFEST["/page"] = {...};` -> the object. */
export function parseClientReferenceManifest(source) {
  const start = source.indexOf('= {');
  const end = source.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Unrecognised client reference manifest');
  return JSON.parse(source.slice(start + 2, end + 1));
}

function main() {
  const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const nextDir = path.join(appDir, '.next');
  const buildManifest = JSON.parse(readFileSync(path.join(nextDir, 'build-manifest.json'), 'utf8'));
  const clientManifest = parseClientReferenceManifest(
    readFileSync(path.join(nextDir, 'server/app/page_client-reference-manifest.js'), 'utf8'),
  );
  const sizes = initialChunks(buildManifest, clientManifest).map((file) => ({
    file,
    gzipBytes: gzipSync(readFileSync(path.join(nextDir, file))).length,
  }));
  const result = evaluateBudget(sizes);
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
  for (const entry of sizes) console.log(`${kb(entry.gzipBytes).padStart(10)}  ${entry.file}`);
  console.log(`${kb(result.total).padStart(10)}  total (budget ${kb(result.budget)} gzip)`);
  if (!result.ok) {
    console.error('Home route initial JS is over budget.');
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
