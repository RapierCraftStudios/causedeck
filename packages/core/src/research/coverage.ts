// Corpus coverage (#1174, part 1 of #1170): how many judgments the research search can find, by court
// and the years they span, so the research page can say what it searches. Only searchable judgments
// count: redacted (`redaction_version > 0`) and segmented from the current redaction, the same rule as
// the retrieval filters. The corpus is global and public: no tenant row is read, nothing is metered
// or audited, and only counts and court codes are returned. Member-checked like the search.
import { schema, type Queryable } from '@causedeck/db';
import { and, gt, sql } from 'drizzle-orm';

import { asMember, type ResearchSearchActor } from './search.ts';

const { judgment } = schema;

export interface CourtCoverage {
  /** Court code as printed in a neutral citation (`MHC`, `INSC`). */
  court: string;
  /** `supreme_court`, `high_court` or `other`; null until enriched. */
  courtLevel: string | null;
  judgments: number;
  /** The earliest and latest judgment year; null when no judgment of the court is dated. */
  yearFrom: number | null;
  yearTo: number | null;
}

export interface CorpusCoverage {
  judgments: number;
  yearFrom: number | null;
  yearTo: number | null;
  /** Most judgments first, then by court code. */
  courts: CourtCoverage[];
}

const toYear = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

/** The searchable judgments of the corpus, in total and by court. */
export async function getCorpusCoverage(
  db: Queryable,
  actor: ResearchSearchActor,
): Promise<CorpusCoverage> {
  return asMember(db, actor, async () => {
    const year = sql<number | null>`extract(year from ${judgment.judgmentDate})::int`;
    const rows = await db
      .select({
        court: judgment.court,
        courtLevel: sql<string | null>`max(${judgment.courtLevel})`,
        judgments: sql<number>`count(*)::int`,
        yearFrom: sql<number | null>`min(${year})`,
        yearTo: sql<number | null>`max(${year})`,
      })
      .from(judgment)
      .where(
        and(
          gt(judgment.redactionVersion, 0),
          sql`${judgment.segmentedRedactionVersion} = ${judgment.redactionVersion}`,
        ),
      )
      .groupBy(judgment.court);
    const courts: CourtCoverage[] = rows
      .map((r) => ({
        court: r.court,
        courtLevel: r.courtLevel,
        judgments: Number(r.judgments),
        yearFrom: toYear(r.yearFrom),
        yearTo: toYear(r.yearTo),
      }))
      .sort((a, b) => b.judgments - a.judgments || a.court.localeCompare(b.court));
    const years = courts.flatMap((c) => [c.yearFrom, c.yearTo]).filter((y) => y !== null);
    return {
      judgments: courts.reduce((n, c) => n + c.judgments, 0),
      yearFrom: years.length === 0 ? null : Math.min(...years),
      yearTo: years.length === 0 ? null : Math.max(...years),
      courts,
    };
  });
}
