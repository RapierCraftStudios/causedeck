// Post-build step: write out/status/feed.xml (RSS) and out/status/atom.xml (Atom) from the verified
// status snapshot. Run after `next build`; the feeds refresh only when the site is rebuilt.
//   tsx scripts/write-feeds.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { siteEnv } from '../lib/env.ts';
import { canonicalUrl } from '../lib/seo.ts';
import { buildAtom, buildRss, loadVerifiedSnapshot } from '../lib/status/feed.ts';

const url = siteEnv.statusUrl.startsWith('/')
  ? `${siteEnv.siteUrl}${siteEnv.statusUrl}`
  : siteEnv.statusUrl;
const snapshot = await loadVerifiedSnapshot(fetch, url, siteEnv.statusVerifyKey);
const dir = path.join(process.cwd(), 'out', 'status');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'feed.xml'), buildRss(snapshot, canonicalUrl('status')));
writeFileSync(path.join(dir, 'atom.xml'), buildAtom(snapshot, canonicalUrl('status')));
console.log('Wrote out/status/feed.xml and out/status/atom.xml.');
