// The global catalogue rows of the demo seed (#1070, #1071): the synthetic judgment corpus (corpus.ts),
// news items and official notices. None of them has a `workspace_id`; the workspace rows that point at
// them (judgment alerts, notice matches) are written with each workspace (modules.ts).
//
// - Fictional only: titles, excerpts and notice texts are invented and marked `SYNTHETIC`, URLs are at
//   `demo.causedeck.test`, the publishers end in "(fictional)".
// - Never fetched: the demo sources are not cleared and carry the kill switch, so no poll job
//   (`news.poll`, `notices.poll`) ever calls their base URL. `listNewsSourceIds` skips them.
// - Idempotent: fixed ids and `onConflictDoNothing`. Dates are offsets from the seed day, so
//   `refreshDemoCatalogue` (run by every workspace seed and reset) moves them to the current day.
// - `seedDemoCatalogue` needs the owner role (the corpus tables and `source` are not app-writable);
//   `seedDemo` (the command) calls it, `seedDemoWorkspace` (the nightly reset, any role) never does.
import { eq, inArray } from 'drizzle-orm';

import {
  judgment,
  judgmentCitationRef,
  judgmentSegment,
  judgmentStatuteRef,
  judgmentTag,
} from '../../schema/corpus.ts';
import { newsItem, type NewsTags } from '../../schema/news.ts';
import { plan } from '../../schema/billing.ts';
import { notice, type NoticeKind } from '../../schema/notices.ts';
import { source } from '../../schema/source-registry.ts';
import type { SeedDb } from '../index.ts';
import { seedPlans } from '../plans.ts';

import { demoCorpusRows } from './corpus.ts';
import { forumCode, type DemoForumKey } from './courts.ts';
import { addDays, demoId, ID_KIND, seedInstant } from './shared.ts';

const GENERIC_SHA = (n: number): string => n.toString(16).padStart(64, '0');
const CATALOGUE_STAMP = new Date('2026-01-01T00:00:00.000Z');

/** The registry rows the demo news items and notices hang off (not cleared, kill switch on). */
export const DEMO_SOURCES = [
  { id: 'demo.news.legal-wire', kind: 'news', owner: 'Demo Legal Wire (fictional)' },
  { id: 'demo.news.bar-bulletin', kind: 'news', owner: 'Demo Bar Bulletin (fictional)' },
  {
    id: 'demo.notice.madras-registry',
    kind: 'notice',
    owner: 'Madras Registry Notices (demo, fictional)',
  },
  {
    id: 'demo.notice.karnataka-registry',
    kind: 'notice',
    owner: 'Karnataka Registry Notices (demo, fictional)',
  },
] as const;

function sourceRows() {
  return DEMO_SOURCES.map((s) => ({
    id: s.id,
    kind: s.kind,
    baseUrl: `https://demo.causedeck.test/${s.id}`,
    owner: s.owner,
    accessMode: 'A0' as const,
    dataClass: 'non-personal' as const,
    killSwitch: true,
    notes: 'Demo seed source (SYNTHETIC): items are written by the seed and never polled.',
    createdAt: CATALOGUE_STAMP,
    updatedAt: CATALOGUE_STAMP,
  }));
}

interface NewsSpec {
  source: (typeof DEMO_SOURCES)[number]['id'];
  title: string;
  excerpt: string;
  tags: NewsTags;
  /** Days before the seed day. */
  ago: number;
}

const NEWS: readonly NewsSpec[] = [
  {
    source: 'demo.news.legal-wire',
    title: 'SYNTHETIC: High Court issues interim directions on listing of urgent bail applications',
    excerpt:
      'SYNTHETIC demo item. A division bench of a fictional High Court restated how urgent bail applications are mentioned and listed.',
    tags: { practiceAreas: ['criminal'], forums: ['high_court'] },
    ago: 0,
  },
  {
    source: 'demo.news.legal-wire',
    title: 'SYNTHETIC: Registry introduces a cure window for defective filings',
    excerpt:
      'SYNTHETIC demo item. The registry of a fictional High Court allows a short cure window before a defective filing is returned.',
    tags: { practiceAreas: ['civil', 'constitutional'], forums: ['high_court'] },
    ago: 1,
  },
  {
    source: 'demo.news.bar-bulletin',
    title:
      'SYNTHETIC: Tribunal clarifies limitation for insolvency applications by financial creditors',
    excerpt:
      'SYNTHETIC demo item. A fictional tribunal explains when the date of default starts the limitation period.',
    tags: { practiceAreas: ['ibc', 'banking'], forums: ['nclt', 'nclat'] },
    ago: 1,
  },
  {
    source: 'demo.news.legal-wire',
    title: 'SYNTHETIC: Consumer commission awards costs for a deficient repair service',
    excerpt:
      'SYNTHETIC demo item. A fictional district commission directed a refund and costs against a service centre.',
    tags: { practiceAreas: ['consumer'], forums: ['consumer_forum'] },
    ago: 2,
  },
  {
    source: 'demo.news.bar-bulletin',
    title: 'SYNTHETIC: Bar council circulates a reminder on advocate welfare fund enrolment',
    excerpt:
      'SYNTHETIC demo item. A fictional state bar council reminds advocates to renew their enrolment records.',
    tags: { practiceAreas: [], forums: ['regulator'] },
    ago: 2,
  },
  {
    source: 'demo.news.legal-wire',
    title: 'SYNTHETIC: Arbitration award challenges: a short guide to the grounds of set-aside',
    excerpt:
      'SYNTHETIC demo item. An explainer on the narrow grounds on which a court sets aside an arbitral award.',
    tags: { practiceAreas: ['arbitration', 'corporate'], forums: ['high_court'] },
    ago: 3,
  },
  {
    source: 'demo.news.bar-bulletin',
    title: 'SYNTHETIC: Rent control appeals: what changed in the new procedure circular',
    excerpt:
      'SYNTHETIC demo item. A fictional circular changes how rent control revision petitions are numbered.',
    tags: { practiceAreas: ['property', 'civil'], forums: ['high_court', 'district_court'] },
    ago: 4,
  },
  {
    source: 'demo.news.legal-wire',
    title: 'SYNTHETIC: Income tax tribunal explains reopening after four years',
    excerpt:
      'SYNTHETIC demo item. A fictional tribunal bench discusses the disclosure test for old assessments.',
    tags: { practiceAreas: ['tax'], forums: ['itat'] },
    ago: 5,
  },
  {
    source: 'demo.news.legal-wire',
    title: 'SYNTHETIC: Writ court sets out a checklist for notice before sealing a stall',
    excerpt:
      'SYNTHETIC demo item. A fictional writ bench lists the steps of a fair hearing before a coercive civic action.',
    tags: { practiceAreas: ['constitutional'], forums: ['high_court'] },
    ago: 6,
  },
  {
    source: 'demo.news.bar-bulletin',
    title: 'SYNTHETIC: Labour court on notice and compensation before retrenchment',
    excerpt:
      'SYNTHETIC demo item. A fictional labour court restates the conditions before a workman is retrenched.',
    tags: { practiceAreas: ['labour', 'service'], forums: ['tribunal'] },
    ago: 8,
  },
];

export interface DemoNewsRow {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  publishedAt: Date;
  excerpt: string;
  tags: NewsTags;
  provenanceSha256: string;
  provenanceFetchedAt: Date;
  provenanceSourceVersion: string;
}

/** The news items for seed day `today`: published 09:00 IST (less a few hours) on the days before it. */
export function demoNewsRows(today: string): DemoNewsRow[] {
  const at = seedInstant(today);
  return NEWS.map((n, i) => {
    const published = new Date(seedInstant(addDays(today, -n.ago)).getTime() - (i % 3) * 3_600_000);
    return {
      id: demoId(ID_KIND.newsItem, i + 1),
      sourceId: n.source,
      title: n.title,
      url: `https://demo.causedeck.test/news/${String(i + 1).padStart(3, '0')}`,
      publishedAt: published,
      excerpt: n.excerpt,
      tags: n.tags,
      provenanceSha256: GENERIC_SHA(i + 1),
      provenanceFetchedAt: at,
      provenanceSourceVersion: 'demo-1',
    };
  });
}

export interface NoticeSpec {
  n: number;
  source: (typeof DEMO_SOURCES)[number]['id'];
  /** The demo forums the notice names (and so matches). */
  forums: readonly DemoForumKey[];
  kind: NoticeKind;
  title: string;
  /** Days before the seed day it was issued, and days after it takes effect (null: no date). */
  ago: number;
  effectiveIn: number | null;
}

export const NOTICES: readonly NoticeSpec[] = [
  {
    n: 1,
    source: 'demo.notice.madras-registry',
    forums: ['mhc'],
    kind: 'circular',
    title: 'SYNTHETIC: Circular on e-filing of counter affidavits (demo)',
    ago: 1,
    effectiveIn: 5,
  },
  {
    n: 2,
    source: 'demo.notice.madras-registry',
    forums: ['mhc'],
    kind: 'practice_direction',
    title: 'SYNTHETIC: Practice direction on mentioning urgent matters (demo)',
    ago: 3,
    effectiveIn: 0,
  },
  {
    n: 3,
    source: 'demo.notice.madras-registry',
    forums: ['mhc'],
    kind: 'roster',
    title: 'SYNTHETIC: Roster of sittings for the coming fortnight (demo)',
    ago: 2,
    effectiveIn: 3,
  },
  {
    n: 4,
    source: 'demo.notice.madras-registry',
    forums: ['mhc'],
    kind: 'holiday',
    title: 'SYNTHETIC: Court holiday for a festival, listing adjusted (demo)',
    ago: 6,
    effectiveIn: 9,
  },
  {
    n: 5,
    source: 'demo.notice.madras-registry',
    forums: ['mhc'],
    kind: 'registry',
    title: 'SYNTHETIC: Registry notice on cure of filing defects within seven days (demo)',
    ago: 4,
    effectiveIn: null,
  },
  {
    n: 6,
    source: 'demo.notice.karnataka-registry',
    forums: ['khc'],
    kind: 'circular',
    title: 'SYNTHETIC: Circular on paper book format for appeals (demo)',
    ago: 1,
    effectiveIn: 7,
  },
  {
    n: 7,
    source: 'demo.notice.karnataka-registry',
    forums: ['khc'],
    kind: 'practice_direction',
    title: 'SYNTHETIC: Practice direction on adjournment requests (demo)',
    ago: 5,
    effectiveIn: 0,
  },
  {
    n: 8,
    source: 'demo.notice.karnataka-registry',
    forums: ['khc', 'ccc'],
    kind: 'roster',
    title: 'SYNTHETIC: Notice of changed benches for the week (demo)',
    ago: 2,
    effectiveIn: 1,
  },
  {
    n: 9,
    source: 'demo.notice.karnataka-registry',
    forums: ['ccc', 'mayo'],
    kind: 'registry',
    title: 'SYNTHETIC: Registry notice on certified copy counters (demo)',
    ago: 3,
    effectiveIn: null,
  },
  {
    n: 10,
    source: 'demo.notice.karnataka-registry',
    forums: ['mayo'],
    kind: 'holiday',
    title: 'SYNTHETIC: Local holiday notice for the city courts (demo)',
    ago: 7,
    effectiveIn: 10,
  },
];

/** The notice rows for `today` (provenance is the seed's, like every demo fact). */
export function demoNoticeRows(today: string) {
  const at = seedInstant(today);
  return NOTICES.map((s) => ({
    id: demoId(ID_KIND.notice, s.n),
    sourceId: s.source,
    forumCodes: s.forums.map(forumCode),
    kind: s.kind,
    title: s.title,
    issuedOn: addDays(today, -s.ago),
    effectiveOn: s.effectiveIn === null ? null : addDays(today, s.effectiveIn),
    url: `https://demo.causedeck.test/notices/${String(s.n).padStart(3, '0')}`,
    sourceType: 'system' as const,
    sourceRef: 'seed:demo',
    confirmationState: 'confirmed' as const,
    capturedAt: at,
    createdAt: at,
    updatedAt: at,
  }));
}

/** Corpus rows insert in batches: a statement carries at most 65535 parameters. */
async function chunked<T>(rows: readonly T[], size: number, put: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await put(rows.slice(i, i + size));
}

/**
 * Write the global rows of the demo (owner role): the registry sources, the judgment corpus with its
 * segments, tags and references, the news items and the notices. A no-op for rows that exist.
 */
export async function seedDemoCatalogue(db: SeedDb, today: string): Promise<void> {
  const corpus = demoCorpusRows();
  // The demo subscriptions reference the plan catalogue (an upsert by id, so a no-op when seeded).
  await seedPlans(db);
  await db.insert(source).values(sourceRows()).onConflictDoNothing();
  await db.insert(judgment).values(corpus.judgments).onConflictDoNothing();
  await chunked(corpus.segments, 100, (b) =>
    db.insert(judgmentSegment).values(b).onConflictDoNothing(),
  );
  await db.insert(judgmentTag).values(corpus.tags).onConflictDoNothing();
  await db.insert(judgmentStatuteRef).values(corpus.statuteRefs).onConflictDoNothing();
  await db.insert(judgmentCitationRef).values(corpus.citationRefs).onConflictDoNothing();
  await db.insert(newsItem).values(demoNewsRows(today)).onConflictDoNothing();
  await db.insert(notice).values(demoNoticeRows(today)).onConflictDoNothing();
}

/**
 * Move the news items and notices to the seed day. Both tables allow the app role to update, so the
 * nightly reset (which runs `seedDemoWorkspace`) keeps the lists current without the owner role. A
 * no-op where the rows were never seeded.
 */
export async function refreshDemoCatalogue(db: SeedDb, today: string): Promise<void> {
  for (const row of demoNewsRows(today)) {
    await db.update(newsItem).set({ publishedAt: row.publishedAt }).where(eq(newsItem.id, row.id));
  }
  for (const row of demoNoticeRows(today)) {
    await db
      .update(notice)
      .set({ issuedOn: row.issuedOn, effectiveOn: row.effectiveOn })
      .where(eq(notice.id, row.id));
  }
}

/** Which of `ids` exist in `judgment` (the alerts of a workspace seed only point at rows that do). */
export async function existingJudgmentIds(
  db: SeedDb,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: judgment.id })
    .from(judgment)
    .where(inArray(judgment.id, [...ids]));
  return new Set(rows.map((r) => r.id));
}

/** Which of `ids` exist in `notice`. */
export async function existingNoticeIds(db: SeedDb, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: notice.id })
    .from(notice)
    .where(inArray(notice.id, [...ids]));
  return new Set(rows.map((r) => r.id));
}

/** Which of `ids` exist in `plan`. */
export async function existingPlanIds(db: SeedDb, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: plan.id })
    .from(plan)
    .where(inArray(plan.id, [...ids]));
  return new Set(rows.map((r) => r.id));
}
