// The bootstrap import plan (#57 part 2, #548): `buildImportPlan` reads the proposals staged for
// the captures of one batch, keeps only what matches the advocate (a draft that names advocates
// must carry one of the identifiers; no identifiers keeps no list rows), clusters proceedings into
// matters, applies the date rules (a date >= today in IST is the next date, an earlier one is
// history, differing future dates are kept as both under a blocking issue) and stores the plan on
// `import_plan` with the batch counters. It proposes only: nothing is written to the matter graph
// (apply and undo are #549), and the content of a row that did not match is never stored or logged.
import { createHash } from 'node:crypto';

import type { Advocate } from '@causedeck/adapters';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';

import { conflict, notFound } from '../shared/errors.ts';

import { clusterProceedings, compareText, type ClusterNode } from './cluster.ts';
import { filterMatchedRows } from './filter-rows.ts';
import type { AdvocateIdentifiers } from './identifiers.ts';
import type {
  ImportPlan,
  PlanDate,
  PlanHistoryEntry,
  PlanIssue,
  PlanMatter,
  PlanProceeding,
  PlanSource,
} from './plan-types.ts';

/** The draft kinds that describe a proceeding or one of its dates. */
const ROW_KINDS = new Set([
  'new_matter',
  'new_proceeding',
  'listing_update',
  'next_date',
  'hearing_outcome',
  'order_record',
]);
const LOW_CONFIDENCE = 0.6;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface ImportDeps {
  db: Database | Transaction;
  now?: () => Date;
  /** Counts only: never row content. */
  log?: (event: string, counts: Record<string, number>) => void;
}

/** A staged proposal as the plan reads it. */
export interface PlanDraftInput {
  proposalId: string;
  captureId: string | null;
  kind: string;
  /** `list` for rows of a cause list: they need an identifier match. */
  input: string | null;
  payload: Record<string, unknown>;
  anchorIds: string[];
  confidence: number | null;
  proceedingId: string | null;
}

/** The IST calendar date of `now` (Asia/Kolkata is a fixed +05:30). */
export function istDay(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
const textList = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap((item) => text(item) ?? []) : [];

function advocatesOf(payload: Record<string, unknown>): Advocate[] | null {
  const value = payload['advocates'];
  if (!Array.isArray(value)) return null;
  return value.flatMap((item): Advocate[] => {
    const entry = (item ?? {}) as Record<string, unknown>;
    const raw = text(entry['raw']);
    if (raw === null) return [];
    const enrolmentNo = text(entry['enrolmentNo']);
    return [
      {
        raw,
        aliases: textList(entry['aliases']),
        ...(enrolmentNo === null ? {} : { enrolmentNo }),
      },
    ];
  });
}

interface Claim {
  date: string;
  source: PlanSource;
}

interface Draft {
  key: string;
  input: PlanDraftInput;
  source: PlanSource;
}

interface Acc {
  key: string;
  fields: Record<string, string | number | null>;
  connected: Set<string>;
  partyKeys: Set<string>;
  claims: Claim[];
  sources: PlanSource[];
  confidence: number;
}

const FIELDS = [
  'caseTypeRaw',
  'caseNumber',
  'forumCode',
  'cnr',
  'parentProceedingKey',
  'parties',
  'lowerCourtRef',
  'stage',
] as const;

function foldDraft(acc: Acc, draft: Draft): void {
  const { payload } = draft.input;
  for (const field of FIELDS) {
    const value = text(payload[field === 'stage' ? 'stageRaw' : field]);
    if (acc.fields[field] == null && value !== null) acc.fields[field] = value;
  }
  const year = payload['caseYear'];
  if (acc.fields['caseYear'] == null && typeof year === 'number') acc.fields['caseYear'] = year;
  for (const key of textList(payload['connectedKeys'])) acc.connected.add(key);
  for (const party of [text(payload['parties']), ...textList(payload['partyAliases'])]) {
    if (party !== null) acc.partyKeys.add(party.toUpperCase().replace(/\s+/g, ' '));
  }
  for (const field of ['listDate', 'date', 'nextDate']) {
    const day = text(payload[field]);
    if (day !== null && DAY.test(day)) acc.claims.push({ date: day, source: draft.source });
  }
  acc.sources.push(draft.source);
  if (draft.input.confidence !== null) {
    acc.confidence = Math.min(acc.confidence, draft.input.confidence);
  }
}

const byDraftId = (a: PlanDraftInput, b: PlanDraftInput): number =>
  compareText(a.proposalId, b.proposalId);

function mergeSources(sources: PlanSource[]): PlanSource[] {
  const seen = new Map(sources.map((source) => [source.proposalId, source]));
  return [...seen.values()].sort((a, b) => compareText(a.proposalId, b.proposalId));
}

function groupDates(claims: Claim[]): PlanDate[] {
  const byDate = new Map<string, PlanSource[]>();
  for (const claim of claims)
    byDate.set(claim.date, [...(byDate.get(claim.date) ?? []), claim.source]);
  return [...byDate.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([date, sources]) => ({ date, sources: mergeSources(sources) }));
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** The plan for `drafts`, and how many rows each capture contributed. Pure and deterministic. */
export function buildPlanFromDrafts(
  drafts: readonly PlanDraftInput[],
  identifiers: AdvocateIdentifiers,
  today: string,
): { plan: ImportPlan; matchedByCapture: Record<string, number> } {
  const rows = drafts.filter((draft) => ROW_KINDS.has(draft.kind)).sort(byDraftId);

  // Matched-only: a draft that names advocates, or comes from a list, must carry an identifier.
  const subject = rows.filter((row) => row.input === 'list' || advocatesOf(row.payload) !== null);
  const subjectSet = new Set(subject);
  const kept = new Set(
    filterMatchedRows(
      subject.map((row) => ({ row, advocates: advocatesOf(row.payload) ?? [] })),
      identifiers,
    ).matched.map((entry) => entry.row),
  );
  const matchedRows = rows.filter((row) => !subjectSet.has(row) || kept.has(row));
  const unmatchedRowsCount = rows.length - matchedRows.length;

  const matchedByCapture: Record<string, number> = {};
  const accs = new Map<string, Acc>();
  for (const input of matchedRows) {
    const key =
      text(input.payload['matchKey']) ?? input.proceedingId ?? text(input.payload['proceedingId']);
    if (key === null) continue;
    if (input.captureId !== null) {
      matchedByCapture[input.captureId] = (matchedByCapture[input.captureId] ?? 0) + 1;
    }
    const source: PlanSource = {
      proposalId: input.proposalId,
      captureId: input.captureId,
      kind: input.kind,
      anchorIds: [...input.anchorIds].sort(),
    };
    const acc = accs.get(key) ?? {
      key,
      fields: {},
      connected: new Set<string>(),
      partyKeys: new Set<string>(),
      claims: [],
      sources: [],
      confidence: 1,
    };
    accs.set(key, acc);
    foldDraft(acc, { key, input, source });
  }

  const nodes: ClusterNode[] = [...accs.values()].map((acc) => ({
    key: acc.key,
    parentKey: (acc.fields['parentProceedingKey'] as string | null | undefined) ?? null,
    connectedKeys: [...acc.connected].sort(),
    cnr: (acc.fields['cnr'] as string | null | undefined) ?? null,
    lowerCourtRef: (acc.fields['lowerCourtRef'] as string | null | undefined) ?? null,
    label: caseLabel(acc),
    partyKeys: [...acc.partyKeys].sort(),
  }));

  const matters: PlanMatter[] = [];
  const history: PlanHistoryEntry[] = [];
  for (const group of clusterProceedings(nodes)) {
    const tempId = `m_${createHash('sha256').update(group.keys.join('\n')).digest('hex').slice(0, 12)}`;
    const issues: PlanIssue[] = [];
    const proceedings: PlanProceeding[] = group.keys.map((key) => {
      const acc = accs.get(key) as Acc;
      const future = groupDates(acc.claims.filter((claim) => claim.date >= today));
      for (const past of groupDates(acc.claims.filter((claim) => claim.date < today))) {
        history.push({
          matterTempId: tempId,
          proceedingKey: key,
          date: past.date,
          sources: past.sources,
        });
      }
      if (future.length > 1) {
        issues.push({
          code: 'conflicting_dates',
          blocking: true,
          proceedingKey: key,
          dates: future.map((d) => d.date),
        });
      }
      return toProceeding(acc, future);
    });
    const main =
      proceedings.find((p) => p.parentKey === null || !group.keys.includes(p.parentKey)) ??
      proceedings[0];
    const confidence = round(
      Math.min(group.confidence, ...group.keys.map((key) => (accs.get(key) as Acc).confidence)),
    );
    if (confidence < LOW_CONFIDENCE) issues.push({ code: 'low_confidence', blocking: false });
    const nextDates = proceedings.flatMap((p) => (p.nextDate === null ? [] : [p.nextDate]));
    matters.push({
      tempId,
      title: main?.parties ?? main?.label ?? main?.key ?? tempId,
      proceedings,
      nextDate: nextDates.sort((a, b) => compareText(a.date, b.date))[0] ?? null,
      issues,
      confidence,
      reason: group.reason,
      sources: mergeSources(proceedings.flatMap((p) => p.sources)),
    });
  }

  history.sort(
    (a, b) =>
      compareText(a.date, b.date) ||
      compareText(a.proceedingKey, b.proceedingKey) ||
      compareText(a.matterTempId, b.matterTempId),
  );
  const plan: ImportPlan = {
    version: 1,
    today,
    matters,
    history,
    obligations: [],
    counts: { matchedRows: matchedRows.length, unmatchedRowsCount },
  };
  return { plan, matchedByCapture };
}

function caseLabel(acc: Acc): string | null {
  const type = acc.fields['caseTypeRaw'];
  const number = acc.fields['caseNumber'];
  const year = acc.fields['caseYear'];
  if (number == null) return null;
  return [type, year == null ? String(number) : `${String(number)}/${String(year)}`]
    .filter((part) => part != null)
    .join(' ');
}

function toProceeding(acc: Acc, future: PlanDate[]): PlanProceeding {
  const f = acc.fields;
  return {
    key: acc.key,
    label: caseLabel(acc),
    caseType: (f['caseTypeRaw'] as string | null | undefined) ?? null,
    caseNumber: f['caseNumber'] == null ? null : String(f['caseNumber']),
    caseYear: typeof f['caseYear'] === 'number' ? f['caseYear'] : null,
    forumCode: (f['forumCode'] as string | null | undefined) ?? null,
    cnr: (f['cnr'] as string | null | undefined) ?? null,
    parentKey: (f['parentProceedingKey'] as string | null | undefined) ?? null,
    parties: (f['parties'] as string | null | undefined) ?? null,
    stage: (f['stage'] as string | null | undefined) ?? null,
    nextDate: future.length === 1 ? (future[0] as PlanDate) : null,
    nextDateCandidates: future.length > 1 ? future : [],
    sources: mergeSources(acc.sources),
  };
}

/**
 * Build and store the plan of `batchId`: the proposals of its files, filtered, clustered and
 * classified against today (IST). Workspace-scoped: another workspace's batch is NOT_FOUND.
 */
export async function buildImportPlan(
  deps: ImportDeps,
  input: { workspaceId: string; batchId: string; identifiers: AdvocateIdentifiers },
): Promise<ImportPlan> {
  const { workspaceId, batchId, identifiers } = input;
  const today = istDay(deps.now?.() ?? new Date());
  return withWorkspace(deps.db, { workspaceId }, async (tx) => {
    const { importBatch, importBatchFile, importPlan, proposal } = schema;
    const [batch] = await tx
      .select({ id: importBatch.id, status: importBatch.status })
      .from(importBatch)
      .where(and(eq(importBatch.workspaceId, workspaceId), eq(importBatch.id, batchId)))
      .for('update');
    if (batch === undefined) throw notFound('Import batch not found');
    if (batch.status === 'applied' || batch.status === 'undone') {
      throw conflict('The batch was already applied: its plan is final');
    }
    const files = await tx
      .select({ captureId: importBatchFile.captureId })
      .from(importBatchFile)
      .where(
        and(eq(importBatchFile.workspaceId, workspaceId), eq(importBatchFile.batchId, batchId)),
      );
    const captureIds = files.map((file) => file.captureId);
    const rows =
      captureIds.length === 0
        ? []
        : await tx
            .select()
            .from(proposal)
            .where(
              and(
                eq(proposal.workspaceId, workspaceId),
                inArray(proposal.captureId, captureIds),
                notInArray(proposal.status, ['dismissed', 'expired', 'superseded']),
              ),
            )
            .orderBy(asc(proposal.id));
    const drafts: PlanDraftInput[] = rows.map((row) => {
      const meta = row.meta as { source?: { input?: unknown } };
      return {
        proposalId: row.id,
        captureId: row.captureId,
        kind: row.kind,
        input: typeof meta.source?.input === 'string' ? meta.source.input : null,
        payload: row.payload,
        anchorIds: row.anchors.filter((anchor): anchor is string => typeof anchor === 'string'),
        confidence: row.confidence === null ? null : Number(row.confidence),
        proceedingId: row.proceedingId,
      };
    });

    const { plan, matchedByCapture } = buildPlanFromDrafts(drafts, identifiers, today);
    const planJson = plan as unknown as Record<string, unknown>;
    await tx
      .insert(importPlan)
      .values({ workspaceId, batchId, plan: planJson })
      .onConflictDoUpdate({ target: importPlan.batchId, set: { plan: planJson } });
    await tx
      .update(importBatch)
      .set({
        matchedRows: plan.counts.matchedRows,
        unmatchedRowsCount: plan.counts.unmatchedRowsCount,
      })
      .where(and(eq(importBatch.workspaceId, workspaceId), eq(importBatch.id, batchId)));
    for (const captureId of captureIds) {
      await tx
        .update(importBatchFile)
        .set({ rowsMatched: matchedByCapture[captureId] ?? 0 })
        .where(
          and(
            eq(importBatchFile.workspaceId, workspaceId),
            eq(importBatchFile.batchId, batchId),
            eq(importBatchFile.captureId, captureId),
          ),
        );
    }
    deps.log?.('import.plan_built', {
      matters: plan.matters.length,
      matchedRows: plan.counts.matchedRows,
      unmatchedRowsCount: plan.counts.unmatchedRowsCount,
    });
    return plan;
  });
}
