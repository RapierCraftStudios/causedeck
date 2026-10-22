// Stores a parse's health (#372): `recordParseRun` reduces a parse to its metrics, reads the
// workspace's last runs for the same forum (the yield history; RLS keeps it to this workspace),
// evaluates them and appends one `adapter_parse_run` row. Server only: it needs the database.
import { db as appDb, withWorkspace, type Queryable } from '@causedeck/db';
import { adapterParseRun } from '@causedeck/db/schema';
import { and, desc, eq } from 'drizzle-orm';

import type { ParsedCauseList } from '../types.ts';

import {
  evaluateParseHealth,
  parseRunMetrics,
  PARSE_HEALTH_THRESHOLDS,
  type ParseHealth,
  type ParseHealthThresholds,
} from './monitor.ts';

export interface RecordParseRunScope {
  db?: Queryable;
  workspaceId: string;
}

export interface RecordParseRunInput {
  /** The supplied document the list was parsed from. */
  documentId: string;
  parsed: ParsedCauseList;
  thresholds?: Partial<ParseHealthThresholds>;
}

export async function recordParseRun(
  { db = appDb, workspaceId }: RecordParseRunScope,
  { documentId, parsed, thresholds = {} }: RecordParseRunInput,
): Promise<{ id: string; health: ParseHealth }> {
  const metrics = parseRunMetrics(parsed);
  const window = thresholds.yieldWindow ?? PARSE_HEALTH_THRESHOLDS.yieldWindow;
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const previous = await tx
      .select({ rowsAnchored: adapterParseRun.rowsAnchored })
      .from(adapterParseRun)
      .where(
        and(
          eq(adapterParseRun.workspaceId, workspaceId),
          eq(adapterParseRun.forumCode, metrics.forumCode),
        ),
      )
      .orderBy(desc(adapterParseRun.createdAt), desc(adapterParseRun.id))
      .limit(window);
    const health = evaluateParseHealth(metrics, {
      history: previous.map((run) => run.rowsAnchored),
      thresholds,
    });
    const [row] = await tx
      .insert(adapterParseRun)
      .values({
        workspaceId,
        documentId,
        adapterId: metrics.adapterId,
        adapterVersion: metrics.adapterVersion,
        forumCode: metrics.forumCode,
        rowsParsed: metrics.rowsParsed,
        rowsAnchored: metrics.rowsAnchored,
        unmappedHeadings: metrics.unmappedHeadings,
        unknownCaseTypes: metrics.unknownCaseTypes,
        hallsSeen: metrics.hallsSeen,
        hallsUnreadable: metrics.hallsUnreadable,
        status: health.status,
      })
      .returning({ id: adapterParseRun.id });
    if (row === undefined) throw new Error('recordParseRun: insert returned no row');
    return { id: row.id, health };
  });
}
