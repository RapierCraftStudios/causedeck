#!/usr/bin/env node
// Bundle budget (spike §10): initial JS for the home route must stay <= 180 KB gzip.
// Run after `next build`: `pnpm --filter @causedeck/web bundle:budget`. For a visual breakdown use
// `pnpm --filter @causedeck/web analyze` (@next/bundle-analyzer).
//
// "Initial JS" = the framework root chunks (build-manifest `rootMainFiles`) plus every client chunk
// the `/page` route can load on first render: layout, page and the root error/loading/not-found
// boundaries (client reference manifest `entryJSFiles`). Each chunk counts once.
//
// Workspace shell (#155): the `/w/[slug]` routes may add at most 42 KB gzip on top of that (40 KB in #155, +2 KB in #593: the precompiled en catalog
// ships in these chunks and the case-watch namespace grew it by ~0.9 KB over a base already at the limit). The
// delta is every initial chunk of `/w/[slug]/today` (shell layout, workspace boundaries, page)
// that the home route does not already load.
//
// Courts routes (#427): `/w/[slug]/courts` and a forum's default tab (`/w/[slug]/courts/[code]/halls`)
// may each add at most 40 KB gzip beyond shared code: every initial chunk of the route that neither
// the home route nor the `/w/[slug]/today` shell route loads (the shell has its own budget above).
//
// Active locale only (#174): no ta/kn catalog string may appear in the home route's initial chunks.
// Messages reach the client through the RSC payload for the active locale, never as bundled JSON.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const BUDGET_BYTES = 180 * 1024;

export const WORKSPACE_SHELL_BUDGET_BYTES = 42 * 1024;

/** The PWA service worker (#50: "<= 60 KB gzip"), bundled to `public/sw.js` by next.config.ts. */
export const SW_BUDGET_BYTES = 60 * 1024;
export const SW_FILE = 'public/sw.js';

/** The workspace route measured for the shell budget. */
export const WORKSPACE_ROUTE_MANIFEST =
  'server/app/(app)/w/[slug]/today/page_client-reference-manifest.js';

export const ROUTE_CHUNK_BUDGET_BYTES = 40 * 1024;

/** The courts routes measured for the route chunk budget (#427). */
export const COURTS_ROUTE_MANIFESTS = [
  'server/app/(app)/w/[slug]/courts/page_client-reference-manifest.js',
  'server/app/(app)/w/[slug]/courts/[code]/halls/page_client-reference-manifest.js',
];

/** What the matters list may add beyond shared code (#388, #40: "<= 25 KB gzip"). */
export const MATTERS_ROUTE_BUDGET_BYTES = 25 * 1024;

/** The matters list route measured for its budget (#388). */
export const MATTERS_ROUTE_MANIFEST =
  'server/app/(app)/w/[slug]/matters/page_client-reference-manifest.js';

/** What the matter Timeline tab may add beyond shared code (#41: "<= 60 KB gzip"). */
export const TIMELINE_ROUTE_BUDGET_BYTES = 60 * 1024;

/**
 * The matter Overview route: its chunks (the matter workspace layout, header and tab bar every tab
 * shares) count as shared code for the Timeline tab (#41), so the budget measures the tab itself.
 */
export const MATTER_WORKSPACE_MANIFEST =
  'server/app/(app)/w/[slug]/matters/[id]/page_client-reference-manifest.js';

/** The matter Timeline route measured for its budget (#41). */
export const TIMELINE_ROUTE_MANIFEST =
  'server/app/(app)/w/[slug]/matters/[id]/timeline/page_client-reference-manifest.js';

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

/** Gzip size of the service worker bundle against its budget. */
export function swBudget(source, budget = SW_BUDGET_BYTES) {
  const gzipBytes = gzipSync(source).length;
  return { gzipBytes, budget, ok: gzipBytes <= budget };
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

/** Catalog folder written by `pnpm i18n:types` in @causedeck/i18n. */
export const GENERATED_MESSAGES = '../../packages/i18n/src/generated/messages';

/** Leaf strings of a catalog. */
function leaves(node) {
  if (typeof node === 'string') return [node];
  if (node === null || typeof node !== 'object') return [];
  return Object.values(node).flatMap(leaves);
}

/**
 * Distinctive strings of the non-English catalogs: ta/kn values of 8+ characters that differ from
 * en and carry no ICU syntax (so they survive precompilation intact).
 */
export function foreignValues(en, others) {
  const english = new Set(leaves(en));
  return [
    ...new Set(
      others
        .flatMap(leaves)
        .filter((value) => value.length >= 8 && !english.has(value) && !/[{}<>#]/.test(value)),
    ),
  ];
}

const escapeUnicode = (value) =>
  value.replace(
    /[^\x20-\x7e]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );

/** `[{ file, value }]` for every foreign catalog string found in a chunk (raw or `\u`-escaped). */
export function localeLeak(chunkSources, values) {
  const leaks = [];
  for (const [file, source] of Object.entries(chunkSources)) {
    for (const value of values) {
      if (source.includes(value) || source.includes(escapeUnicode(value)))
        leaks.push({ file, value });
    }
  }
  return leaks;
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
  const courtsChunks = COURTS_ROUTE_MANIFESTS.map((manifest) => [manifest, chunksOf(manifest)]);
  const mattersChunks = chunksOf(MATTERS_ROUTE_MANIFEST);
  const timelineChunks = chunksOf(TIMELINE_ROUTE_MANIFEST);
  const workspaceChunks = chunksOf(MATTER_WORKSPACE_MANIFEST);
  const gzipBytes = {};
  for (const file of new Set([
    ...homeChunks,
    ...routeChunks,
    ...courtsChunks.flatMap(([, c]) => c),
    ...mattersChunks,
    ...timelineChunks,
    ...workspaceChunks,
  ])) {
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

  const sharedChunks = [...homeChunks, ...routeChunks];
  const courts = courtsChunks.map(([manifest, chunks]) => {
    const delta = shellDelta(sharedChunks, chunks, gzipBytes, ROUTE_CHUNK_BUDGET_BYTES);
    console.log(`\nCourts route ${manifest}, chunks beyond shared code:`);
    for (const file of delta.files) console.log(`${kb(gzipBytes[file]).padStart(10)}  ${file}`);
    console.log(`${kb(delta.total).padStart(10)}  route delta (budget ${kb(delta.budget)} gzip)`);
    return { manifest, delta };
  });

  const matters = shellDelta(sharedChunks, mattersChunks, gzipBytes, MATTERS_ROUTE_BUDGET_BYTES);
  console.log(`\nMatters route ${MATTERS_ROUTE_MANIFEST}, chunks beyond shared code:`);
  for (const file of matters.files) console.log(`${kb(gzipBytes[file]).padStart(10)}  ${file}`);
  console.log(`${kb(matters.total).padStart(10)}  route delta (budget ${kb(matters.budget)} gzip)`);

  const timeline = shellDelta(
    [...sharedChunks, ...workspaceChunks],
    timelineChunks,
    gzipBytes,
    TIMELINE_ROUTE_BUDGET_BYTES,
  );
  console.log(
    `\nTimeline route ${TIMELINE_ROUTE_MANIFEST}, chunks beyond shared code and the matter workspace:`,
  );
  for (const file of timeline.files) console.log(`${kb(gzipBytes[file]).padStart(10)}  ${file}`);
  console.log(
    `${kb(timeline.total).padStart(10)}  route delta (budget ${kb(timeline.budget)} gzip)`,
  );

  const readCatalog = (locale) =>
    JSON.parse(readFileSync(path.join(appDir, GENERATED_MESSAGES, `${locale}.json`), 'utf8'));
  const leaks = localeLeak(
    Object.fromEntries(
      homeChunks.map((file) => [file, readFileSync(path.join(nextDir, file), 'utf8')]),
    ),
    foreignValues(readCatalog('en'), [readCatalog('ta'), readCatalog('kn')]),
  );
  console.log(`\nta/kn catalog strings in the home route's initial JS: ${leaks.length}`);

  const sw = swBudget(readFileSync(path.join(appDir, SW_FILE)));
  console.log(`\nService worker ${SW_FILE}: ${kb(sw.gzipBytes)} (budget ${kb(sw.budget)} gzip)`);

  let failed = false;
  if (!sw.ok) {
    console.error('The service worker bundle is over budget.');
    failed = true;
  }
  if (leaks.length > 0) {
    for (const leak of leaks.slice(0, 10)) console.error(`  ${leak.file}: "${leak.value}"`);
    console.error('Non-active locale messages are bundled into the en home route.');
    failed = true;
  }
  if (!result.ok) {
    console.error('Home route initial JS is over budget.');
    failed = true;
  }
  if (!shell.ok) {
    console.error('The workspace shell adds more initial JS than its budget.');
    failed = true;
  }
  for (const { manifest, delta } of courts) {
    if (!delta.ok) {
      console.error(`Courts route ${manifest} adds more initial JS than its budget.`);
      failed = true;
    }
  }
  if (!matters.ok) {
    console.error(`Matters route ${MATTERS_ROUTE_MANIFEST} adds more initial JS than its budget.`);
    failed = true;
  }
  if (!timeline.ok) {
    console.error(
      `Timeline route ${TIMELINE_ROUTE_MANIFEST} adds more initial JS than its budget.`,
    );
    failed = true;
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
