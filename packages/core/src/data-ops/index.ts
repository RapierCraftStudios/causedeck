// The data-operations domain (#515, D-049): SLO detectors over `fetch_log` and parse runs, the
// alert ledger, routing to Slack and email, and the block and parse-yield auto-responses.
import { schema, type Queryable } from '@causedeck/db';

export * from './alerts.ts';
export * from './detectors.ts';
export * from './response.ts';
export * from './routing.ts';
export * from './runbooks.ts';

/** One parse run of a source's parser, written by adapters; counts only, never parsed content. */
export interface ParseRunInput {
  sourceId: string;
  parserVersion: string;
  /** Records the page should have yielded (the parser's own expectation). */
  expected: number;
  parsed: number;
  /** Parsed records that disagreed with an existing record. */
  conflicts?: number;
  ranAt?: Date;
}

/** Append one `source_parse_run` row; the evaluator reads the latest per source. */
export async function recordParseRun(db: Queryable, run: ParseRunInput): Promise<void> {
  await db.insert(schema.sourceParseRun).values({
    sourceId: run.sourceId,
    parserVersion: run.parserVersion,
    expected: run.expected,
    parsed: run.parsed,
    conflicts: run.conflicts ?? 0,
    ...(run.ranAt === undefined ? {} : { ranAt: run.ranAt }),
  });
}
