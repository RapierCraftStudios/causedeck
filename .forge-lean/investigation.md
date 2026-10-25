**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (feature; the public status page does not exist)
**Task Type**: feature

### What Was Claimed
Part 3 of #96: in `apps/site` (static Next app, Cloudflare Pages) add `app/status/page.tsx` (static shell, client fetch of `status.json` with HMAC verification, "Status data could not be verified", stale >5 min warning, "Status unavailable, retry", skeleton, empty "All systems operational", offline), components overall-banner, component-row, uptime-strip, incident-list, subscribe-links (+ stories), `app/status/history/page.tsx`, `app/status/feed.xml/route.ts` (RSS and Atom, sanitised like the JSON). Text+icon status, live region, IST and UTC timestamps, light and dark. Depends on #769.

Note: the pre-existing `.forge-lean/*` files (investigation, result "fixed") described #769; they were replaced.

### What We Found
(verified on `origin/milestone/site-onboarding-launch` = d03a2bc4, which contains merged #769)
- `apps/site` already exists (scaffold, `output: 'export'`, `apps/site/next.config.ts:10`), so "scaffold if absent" is already satisfied. No `app/status`, no status components, no Storybook config in the site (`apps/site/.storybook` absent; stories live only in `packages/ui` and `apps/web`).
- Snapshot contract: `packages/core/src/status/model.ts:8-62` (`version:1`, `generatedAt`, `overall`, `components[{id,name,status}]` ids `database|storage|court`, `incidents[{id,title,severity,state,component,startedAt,resolvedAt,updates[{state,body,at}]}]`, `signature{alg:'HS256',value:hex64}`).
- Signing: `packages/core/src/status/publish.ts:224-250` HMAC-SHA256 over `canonicalStatusJson` (sorted keys, undefined dropped) of the snapshot minus signature; `STALE_AFTER_SEC = 300` (`publish.ts:41`), `COURT_COMPONENT_NAME = 'Parsing of documents you share'` (`publish.ts:46`), `STATUS_OBJECT_PATH = 'status/status.json'` (`publish.ts:44`). Dev key `DEV_STATUS_SIGNING_KEY` at `packages/config/src/env/schema.ts:23`.
- `@causedeck/core/status` cannot be imported by the static site: `publish.ts` uses `node:crypto` and the core package drags db/storage; `apps/site/package.json` depends only on `@causedeck/ui`, next, zod etc. The page must carry its own browser (WebCrypto) schema and verifier mirroring core's canonical JSON.
- Site env boundary: `apps/site/lib/env.ts:11-17` (zod, all `NEXT_PUBLIC_*`); needs status URL and verify key entries.
- CSP: `apps/site/scripts/write-headers.ts:32-44` `connect-src 'self'` plus analytics origin only; a cross-origin status URL needs its origin added. Tests: `apps/site/src/site-scaffold.test.ts` (headers, env, static export, rule36), vitest includes `src/**`, `lib/**`, `scripts/**` only (`apps/site/vitest.config.ts:7`), node env, jsdom opt-in per file (`jsdom` is not a site devDependency).
- Navigation/SEO: `apps/site/components/site-footer.tsx:4-8` link columns; `apps/site/app/sitemap.ts` enumerates only MDX pages (status pages would need adding); `apps/site/lib/seo.ts` `pageMetadata`.
- UI primitives available from `@causedeck/ui` subpath exports: `badge`, `alert`, `skeleton`, `card` (`packages/ui/package.json` exports).
- Static feed route: `app/robots.ts:5` shows the `export const dynamic = 'force-static'` pattern for route handlers under export.

### Root Cause
Missing feature: #769 supplies the signed snapshot, but no public consumer exists.

### Affected Files
- new `apps/site/lib/status/{model,verify,state,format,feed}.ts` (+ tests)
- new `apps/site/components/status/{overall-banner,component-row,uptime-strip,incident-list,subscribe-links,status-view}.tsx` + `*.stories.tsx`
- new `apps/site/app/status/page.tsx`, `app/status/history/page.tsx`, `app/status/feed.xml/route.ts`, `app/status/atom.xml/route.ts`
- `apps/site/lib/env.ts`, `apps/site/scripts/write-headers.ts`, `apps/site/components/site-footer.tsx`, `apps/site/app/sitemap.ts`, `apps/site/README.md`
- `apps/site/package.json` (+ lockfile) and `.storybook/` only if stories get a runner (see contract K3)

### Sibling Sweep
`apps/web` has its own adapter status card (`apps/web/components/courts/adapter-status-card.tsx`), authenticated and unrelated. No other public page fetches signed data. #770 (admin console) and #772 (e2e/visual/Lighthouse) are siblings, not touched here.

### History
Snapshot and publisher introduced by #769 (merge d03a2bc4 lineage, PR #787). No earlier status page; #96 closed not_planned.

### Recommendation
Implement as in contract.json. Keep all logic in pure, node-testable modules under `apps/site/lib/status` (zod parse, WebCrypto HMAC verify, state derivation: verified/unverified/stale/unavailable/empty, IST+UTC formatting, feed builders) and keep components thin. Note the inherent limit: HS256 verification in a browser needs the key in public JS, so it detects corruption and accidental/partial tampering, not a determined forger; the issue prescribes it and the key is a public build-time value.

### Related Issues
#96 (parent), #769 (dependency, merged), #770, #772 (siblings).
