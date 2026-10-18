#!/usr/bin/env node
// Bundle budget (spike §10): initial JS for the home route must stay <= 180 KB gzip.
// Run after `next build`: `pnpm --filter @causedeck/web bundle:budget`. For a visual breakdown use
// `pnpm --filter @causedeck/web analyze` (@next/bundle-analyzer).
//
// "Initial JS" = the framework root chunks (build-manifest `rootMainFiles`) plus every client chunk
// the `/page` route can load on first render: layout, page and the root error/loading/not-found
// boundaries (client reference manifest `entryJSFiles`). Each chunk counts once.
//
// Workspace shell (#155): the `/w/[slug]` routes may add at most 40 KB gzip on top of that. The
// delta is every initial chunk of `/w/[slug]/today` (shell layout, workspace boundaries, page)
// that the home route does not already load.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const BUDGET_BYTES = 180 * 1024;

export const WORKSPACE_SHELL_BUDGET_BYTES = 40 * 1024;

/** The workspace route measured for the shell budget. */
export const WORKSPACE_ROUTE_MANIFEST =
  'server/app/(app)/w/[slug]/today/page_client-reference-manifest.js';

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

/**
 * Gzip bytes the workspace route adds over the home route: its chunks that home does not load,
 * each once. `sizes` maps a chunk path to its gzip size.
 */
export function shellDelta(homeChunks, routeChunks, sizes, budget = WORKSPACE_SHELL_BUDGET_BYTES) {
  const home = new Set(homeChunks);
  const files = [...new Set(routeChunks)].filter((file) => !home.has(file)).sort();
  const total = files.reduce((sum, file) => sum + (sizes[file] ?? 0), 0);
  return { files, total, budget, ok: total <= budget };
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
  const chunksOf = (manifestPath) =>
    initialChunks(
      buildManifest,
      parseClientReferenceManifest(readFileSync(path.join(nextDir, manifestPath), 'utf8')),
    );
  const homeChunks = chunksOf('server/app/page_client-reference-manifest.js');
  const routeChunks = chunksOf(WORKSPACE_ROUTE_MANIFEST);
  const gzipBytes = {};
  for (const file of new Set([...homeChunks, ...routeChunks])) {
    gzipBytes[file] = gzipSync(readFileSync(path.join(nextDir, file))).length;
  }
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

  const sizes = homeChunks.map((file) => ({ file, gzipBytes: gzipBytes[file] }));
  const result = evaluateBudget(sizes);
  for (const entry of sizes) console.log(`${kb(entry.gzipBytes).padStart(10)}  ${entry.file}`);
  console.log(`${kb(result.total).padStart(10)}  total (budget ${kb(result.budget)} gzip)`);

  const shell = shellDelta(homeChunks, routeChunks, gzipBytes);
  console.log('\nWorkspace route /w/[slug]/today, chunks beyond the home route:');
  for (const file of shell.files) console.log(`${kb(gzipBytes[file]).padStart(10)}  ${file}`);
  console.log(`${kb(shell.total).padStart(10)}  shell delta (budget ${kb(shell.budget)} gzip)`);

  let failed = false;
  if (!result.ok) {
    console.error('Home route initial JS is over budget.');
    failed = true;
  }
  if (!shell.ok) {
    console.error('The workspace shell adds more initial JS than its budget.');
    failed = true;
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
