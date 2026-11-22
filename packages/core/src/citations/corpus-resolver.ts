// The corpus citation resolver (#1135, part 3 of #1117; D-004, D-053, ADR 0051): a `CitationResolver`
// over the global, anonymised corpus. Neutral citations go through `verifyCitation`, case numbers
// through `judgment.case_numbers` (stored as printed, compared in the drafting normal form), sections
// through the statutes layer, and pinpoints and quotes through `verifyPinpoint`. A reporter citation
// is never resolved here, so it stays `unknown` (the official-links fallback applies) and is never
// `verified`. A hit carries the citation, the stored (masked) title, the source URL and a status:
// no judgment text, quote or anchor leaves this module, and nothing is audited or logged.
import { db as appDb, schema, type Queryable } from '@causedeck/db';
import {
  normalizeCitation,
  type CitationResolver,
  type ResolveRequest,
  type ResolverHit,
  type ResolverOutcome,
} from '@causedeck/drafting';
import { eq, sql } from 'drizzle-orm';

import { resolveSectionRef } from '../statutes/index.ts';

import { verifyCitation } from './verify.ts';
import { verifyPinpoint } from './verify-quote.ts';

const { judgment } = schema;

/** The most stored judgments one case-number lookup compares. */
const CASE_NUMBER_CANDIDATES = 20;

export interface CorpusResolverOptions {
  db?: Queryable;
}

interface StoredJudgment {
  id: string;
  title: string;
  titleMasked: boolean;
  sourceUrl: string;
}

const SECTION_FORM = /^(?<statute>[A-Z]+) s (?<section>\S+)$/;
const CASE_NUMBER_FORM = /^\S+ (?<no>\d+)\/(?<year>\d{4})$/;

async function storedJudgment(db: Queryable, id: string): Promise<StoredJudgment | null> {
  const [row] = await db
    .select({
      id: judgment.id,
      caseTitle: judgment.caseTitle,
      titleMasked: judgment.titleMasked,
      url: sql<string>`${judgment.provenance}->>'url'`,
    })
    .from(judgment)
    .where(eq(judgment.id, id))
    .limit(1);
  if (row === undefined) return null;
  return {
    id: row.id,
    title: row.caseTitle ?? '',
    titleMasked: row.titleMasked,
    sourceUrl: row.url,
  };
}

/** Stored judgments whose printed case number normalises to `normalized`. */
async function byCaseNumber(db: Queryable, normalized: string): Promise<StoredJudgment[]> {
  const parts = CASE_NUMBER_FORM.exec(normalized)?.groups;
  if (parts?.no === undefined || parts.year === undefined) return [];
  // Prefilter on the number and year; the exact comparison is in the drafting normal form below,
  // because `case_numbers` holds the header text as printed (`W.P.No.12345 of 2026`).
  const pattern = `(^|[^0-9])0*${parts.no}\\s*(of|/)\\s*${parts.year}([^0-9]|$)`;
  const rows = await db
    .select({
      id: judgment.id,
      caseNumbers: judgment.caseNumbers,
      caseTitle: judgment.caseTitle,
      titleMasked: judgment.titleMasked,
      url: sql<string>`${judgment.provenance}->>'url'`,
    })
    .from(judgment)
    .where(sql`exists (select 1 from unnest(${judgment.caseNumbers}) as n where n ~* ${pattern})`)
    .limit(CASE_NUMBER_CANDIDATES);
  return rows
    .filter((row) => (row.caseNumbers ?? []).some((n) => normalizeCitation(n) === normalized))
    .map((row) => ({
      id: row.id,
      title: row.caseTitle ?? '',
      titleMasked: row.titleMasked,
      sourceUrl: row.url,
    }));
}

async function judgmentHits(
  db: Queryable,
  request: ResolveRequest,
  found: readonly StoredJudgment[],
): Promise<ResolverOutcome> {
  const wantsCheck = request.pinpoint !== undefined || request.quote !== undefined;
  const hits: ResolverHit[] = [];
  for (const j of found) {
    const hit: ResolverHit = {
      citation: request.normalized,
      title: j.title,
      sourceUrl: j.sourceUrl,
      titleMasked: j.titleMasked,
    };
    if (wantsCheck) {
      const { status } = await verifyPinpoint(
        j.id,
        {
          ...request.pinpoint,
          ...(request.quote === undefined ? {} : { quote: request.quote }),
        },
        { db },
      );
      hit.check = { quote: status };
    }
    hits.push(hit);
  }
  return { kind: 'hits', hits };
}

async function resolveSection(db: Queryable, normalized: string): Promise<ResolverOutcome> {
  const parts = SECTION_FORM.exec(normalized)?.groups;
  if (parts?.statute === undefined || parts.section === undefined)
    return { kind: 'hits', hits: [] };
  const found = await resolveSectionRef({ statute: parts.statute, section: parts.section }, { db });
  if (found === null) return { kind: 'hits', hits: [] };
  // A statute section is public law, not a judgment: its title is the act's, so no title check.
  return {
    kind: 'hits',
    hits: [
      {
        citation: normalized,
        title: `${found.act.title} s ${found.section}`,
        sourceUrl: '',
        titleMasked: true,
      },
    ],
  };
}

/** A `CitationResolver` over the corpus; no call leaves the process. */
export function createCorpusResolver({ db = appDb }: CorpusResolverOptions = {}): CitationResolver {
  return {
    name: 'corpus',
    external: false,
    async resolve(request: ResolveRequest): Promise<ResolverOutcome> {
      switch (request.kind) {
        case 'neutral': {
          const result = await verifyCitation(request.normalized, { db });
          if (result.status !== 'VERIFIED') return { kind: 'hits', hits: [] };
          // The page anchors are built from `page_text`; only the id is used, never the anchors.
          const stored = await storedJudgment(db, result.judgmentId);
          return judgmentHits(db, request, stored === null ? [] : [stored]);
        }
        case 'case_number':
          return judgmentHits(db, request, await byCaseNumber(db, request.normalized));
        case 'section':
          return resolveSection(db, request.normalized);
        default:
          // Reporter citations (and any other kind) are not stored in the corpus: never verified.
          return { kind: 'unavailable' };
      }
    },
  };
}
