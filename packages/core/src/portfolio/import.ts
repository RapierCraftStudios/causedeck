// Portfolio CSV import (#663, part 3 of #498, D-048 B2B): an owner uploads up to 1,000 case numbers
// or CNRs; each becomes a `portfolio_case`, and every case whose CNR is already a proceeding of the
// workspace also gets a delegated `case_watch` under one of the portfolio's panel advocates who can
// read that matter, never more than the per-advocate cap and only at a cleared status source. The
// import never fetches: the existing poll (`pollCaseWatches`) runs the watches within its own
// per-advocate, per-source and total caps, and the first polls are staggered over one cadence so a
// big import does not make everything due at once. A bare CNR (no proceeding yet) stays an
// unwatched portfolio case: a watch needs a proceeding and its matter for the delegated lookup.
import { schema, withWorkspace } from '@causedeck/db';
import { and, eq, inArray } from 'drizzle-orm';

import { STATUS_SOURCES } from '../case-watch/index.ts';
import { getCanonicalNextDate } from '../matter-graph/index.ts';
import { invalid } from '../shared/errors.ts';
import { isCleared } from '../sources/index.ts';

import { loadPortfolio, requirePortfolioAccess, type Db, type PortfolioActor } from './access.ts';
import { parsePortfolioCsv, type PortfolioCsvError } from './csv.ts';

const { caseWatch, portfolioCase, portfolioPanelAdvocate, proceeding } = schema;

/** Watches one panel advocate may hold from imports (the poll caps still apply per run). */
export const MAX_PORTFOLIO_WATCHES_PER_ADVOCATE = 250;
/** Poll cadence of an imported watch. */
export const PORTFOLIO_WATCH_CADENCE_MINUTES = 1440;

export interface ImportPortfolioInput {
  portfolioId: string;
  csv: string;
  /** The status source for rows without a `source` column value. */
  sourceId?: string;
}

export interface ImportPortfolioDeps {
  db: Db;
  now?: () => Date;
}

export interface ImportPortfolioReport {
  /** Portfolio cases created. */
  created: number;
  /** Rows whose CNR the portfolio already held. */
  duplicates: number;
  /** Rows that were not a valid case reference (see `errors`). */
  invalid: number;
  errors: PortfolioCsvError[];
  /** Delegated watches created (or already present) for the new cases. */
  watched: number;
  /** New cases with no watch: no matching proceeding, no cleared source, or no advocate with room. */
  unwatched: number;
}

export async function importPortfolioCases(
  deps: ImportPortfolioDeps,
  actor: PortfolioActor,
  input: ImportPortfolioInput,
): Promise<ImportPortfolioReport> {
  await requirePortfolioAccess(deps.db, actor, { ownerOnly: true });
  await loadPortfolio(deps.db, actor, input.portfolioId);
  const parsed = parsePortfolioCsv(input.csv);
  const now = (deps.now ?? (() => new Date()))();

  const sourceOf = (row: { sourceId: string | null }) => row.sourceId ?? input.sourceId ?? null;
  const sources = [...new Set(parsed.rows.map(sourceOf).filter((s) => s !== null))];
  const cleared = new Map<string, boolean>();
  for (const id of sources) cleared.set(id, await isCleared(id, { db: deps.db }));

  // Phase 1: store the cases and read the context the watches need.
  const stored = await withWorkspace(deps.db, actor, async (tx) => {
    const sourceIds = new Set(
      (await tx.select({ id: schema.source.id }).from(schema.source)).map((s) => s.id),
    );
    for (const id of sources) if (!sourceIds.has(id)) throw invalid(`Unknown source ${id}`);
    const cnrs = parsed.rows.flatMap((r) => (r.cnr === null ? [] : [r.cnr]));
    const proceedings = new Map<string, string>();
    for (let i = 0; i < cnrs.length; i += 500) {
      const found = await tx
        .select({ id: proceeding.id, cnr: proceeding.cnr })
        .from(proceeding)
        .where(
          and(
            eq(proceeding.workspaceId, actor.workspaceId),
            inArray(proceeding.cnr, cnrs.slice(i, i + 500)),
          ),
        );
      for (const p of found) if (p.cnr !== null) proceedings.set(p.cnr, p.id);
    }
    const created: {
      id: string;
      cnr: string | null;
      proceedingId: string | null;
      sourceId: string | null;
    }[] = [];
    let duplicates = 0;
    for (let i = 0; i < parsed.rows.length; i += 200) {
      const chunk = parsed.rows.slice(i, i + 200);
      const rows = await tx
        .insert(portfolioCase)
        .values(
          chunk.map((r) => ({
            workspaceId: actor.workspaceId,
            portfolioId: input.portfolioId,
            cnr: r.cnr,
            caseNumber: r.caseNumber,
            sourceId: sourceOf(r),
            proceedingId: r.cnr === null ? null : (proceedings.get(r.cnr) ?? null),
          })),
        )
        .onConflictDoNothing()
        .returning({
          id: portfolioCase.id,
          cnr: portfolioCase.cnr,
          proceedingId: portfolioCase.proceedingId,
          sourceId: portfolioCase.sourceId,
        });
      duplicates += chunk.length - rows.length;
      created.push(...rows);
    }
    const panel = await tx
      .select({ userId: portfolioPanelAdvocate.advocateUserId })
      .from(portfolioPanelAdvocate)
      .where(
        and(
          eq(portfolioPanelAdvocate.workspaceId, actor.workspaceId),
          eq(portfolioPanelAdvocate.portfolioId, input.portfolioId),
        ),
      )
      .orderBy(portfolioPanelAdvocate.advocateUserId);
    const held = new Map<string, number>();
    if (panel.length > 0) {
      const rows = await tx
        .select({ advocate: caseWatch.advocateUserId, id: caseWatch.id })
        .from(caseWatch)
        .where(
          and(
            eq(caseWatch.workspaceId, actor.workspaceId),
            inArray(
              caseWatch.advocateUserId,
              panel.map((p) => p.userId),
            ),
          ),
        );
      for (const r of rows) held.set(r.advocate, (held.get(r.advocate) ?? 0) + 1);
    }
    return { created, duplicates, panel: panel.map((p) => p.userId), held };
  });

  // Phase 2: assign each watchable case to a panel advocate who can read its matter.
  const candidates = stored.created.filter(
    (c) =>
      c.proceedingId !== null &&
      c.sourceId !== null &&
      c.sourceId in STATUS_SOURCES &&
      cleared.get(c.sourceId) === true,
  );
  const readable = new Map<string, boolean>();
  const canRead = async (advocate: string, proceedingId: string): Promise<boolean> => {
    const key = `${advocate}:${proceedingId}`;
    const known = readable.get(key);
    if (known !== undefined) return known;
    const ok = await getCanonicalNextDate(
      { db: deps.db, events: { emit() {} } },
      { userId: advocate, workspaceId: actor.workspaceId },
      { proceedingId },
    ).then(
      () => true,
      () => false,
    );
    readable.set(key, ok);
    return ok;
  };
  const assigned: {
    advocate: string;
    proceedingId: string;
    sourceId: string;
    cnr: string | null;
    slot: number;
  }[] = [];
  let turn = 0;
  for (const c of candidates) {
    for (let k = 0; k < stored.panel.length; k += 1) {
      const advocate = stored.panel[(turn + k) % stored.panel.length];
      if (advocate === undefined) break;
      if ((stored.held.get(advocate) ?? 0) >= MAX_PORTFOLIO_WATCHES_PER_ADVOCATE) continue;
      if (!(await canRead(advocate, c.proceedingId ?? ''))) continue;
      stored.held.set(advocate, (stored.held.get(advocate) ?? 0) + 1);
      assigned.push({
        advocate,
        proceedingId: c.proceedingId ?? '',
        sourceId: c.sourceId ?? '',
        cnr: c.cnr,
        slot: assigned.length,
      });
      turn = (turn + k + 1) % stored.panel.length;
      break;
    }
  }

  // Phase 3: create the watches; the first poll of each is spread over one cadence.
  const cadenceMs = PORTFOLIO_WATCH_CADENCE_MINUTES * 60_000;
  let watched = 0;
  if (assigned.length > 0) {
    watched = await withWorkspace(deps.db, actor, async (tx) => {
      let count = 0;
      for (let i = 0; i < assigned.length; i += 200) {
        const chunk = assigned.slice(i, i + 200);
        const rows = await tx
          .insert(caseWatch)
          .values(
            chunk.map((a) => ({
              workspaceId: actor.workspaceId,
              proceedingId: a.proceedingId,
              sourceId: a.sourceId,
              cnr: a.cnr,
              advocateUserId: a.advocate,
              cadenceMinutes: PORTFOLIO_WATCH_CADENCE_MINUTES,
              lastPolledAt: new Date(
                now.getTime() - cadenceMs + Math.floor((a.slot / assigned.length) * cadenceMs),
              ),
            })),
          )
          .onConflictDoNothing()
          .returning({ id: caseWatch.id });
        count += rows.length;
      }
      return count;
    });
  }

  return {
    created: stored.created.length,
    duplicates: stored.duplicates,
    invalid: parsed.errors.length,
    errors: parsed.errors,
    watched,
    unwatched: stored.created.length - watched,
  };
}
