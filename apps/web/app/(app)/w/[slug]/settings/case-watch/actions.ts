'use server';
// Case-status watch actions (#593, part 5 of #483, D-048 tier 4): the advocate's own watches on
// their proceedings, a server refresh and the recording of a status the device read. Each goes
// through `workspaceAction` with the `matter.write` policy action and calls `@causedeck/core/case-watch`
// on the action's workspace transaction, scoped to the member. Dark until the legal-gated flag
// `court.case-status` is on for the workspace: with it off every action is NOT_FOUND.
// - The refresh is a delegated lookup: core always calls the fetch layer with `delegatedFor` (this
//   advocate and the watched proceeding's matter), so a bulk or unscoped lookup cannot be made here.
//   It reports the tier used and the cost, the provenance of the server fallback.
// - A device-read status is untrusted client input: it is validated against the parsed-status schema
//   again here before it is stored with `via: 'device'`.
// Status diffs become proposals (core); nothing here confirms one, and no court page or captcha is
// ever returned to the client.
import { ParsedCaseStatusSchema } from '@causedeck/adapters';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { webStatusFetcher } from '../../../../../../lib/case-watch/fetcher.ts';
import { domainErrorCode } from '../../../../../../lib/matters/graph-deps.ts';
import { ActionError, type Result } from '../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../lib/workspace-action.ts';

export interface CaseWatchView {
  id: string;
  proceedingId: string;
  sourceId: string;
  cnr: string | null;
  caseNumber: string | null;
  cadenceMinutes: number;
  lastPolledAt: string | null;
}

export interface CaseStatusRefreshed {
  outcome: 'changed' | 'unchanged' | 'not_found' | 'unrecognised';
  proposals: number;
  /** The tier the lookup used (null when the page was not fetched), recorded with the snapshot. */
  tierUsed: string | null;
  costDollars: number;
}

export interface DeviceStatusRecorded {
  outcome: 'changed' | 'unchanged' | 'not_found' | 'unrecognised';
  proposals: number;
}

async function requireFlag(ctx: WorkspaceActionCtx): Promise<void> {
  const { isEnabled } = await import('@causedeck/flags/server');
  const on = await isEnabled('court.case-status', {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
  });
  if (!on) throw new ActionError('NOT_FOUND', '');
}

const actorOf = (ctx: WorkspaceActionCtx) => ({
  workspaceId: ctx.workspaceId,
  userId: ctx.userId,
});

const DOMAIN_CODES = ['NOT_FOUND', 'FORBIDDEN', 'CONFLICT', 'VALIDATION'] as const;

/**
 * Runs a core call: its domain errors become the matching `ActionError`, and an uncleared source or a
 * denied fetch (kill switch, rate limit, caps) is FORBIDDEN, never INTERNAL.
 */
async function guarded<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const code = domainErrorCode(error);
    if (code !== undefined && (DOMAIN_CODES as readonly string[]).includes(code)) {
      throw new ActionError(code as (typeof DOMAIN_CODES)[number], (error as Error).message);
    }
    if (error instanceof Error && (error.name === 'SourceNotCleared' || error.name === 'FetchDenied')) {
      throw new ActionError('FORBIDDEN', 'This status source cannot be read right now');
    }
    throw error;
  }
}

const toView = (row: {
  id: string;
  proceedingId: string;
  sourceId: string;
  cnr: string | null;
  caseNumber: string | null;
  cadenceMinutes: number;
  lastPolledAt: Date | null;
}): CaseWatchView => ({
  id: row.id,
  proceedingId: row.proceedingId,
  sourceId: row.sourceId,
  cnr: row.cnr,
  caseNumber: row.caseNumber,
  cadenceMinutes: row.cadenceMinutes,
  lastPolledAt: row.lastPolledAt === null ? null : row.lastPolledAt.toISOString(),
});

function revalidate(): void {
  revalidatePath('/w/[slug]/matters/[id]', 'layout');
  revalidatePath('/w/[slug]/settings/case-watch', 'page');
}

const AddInput = WorkspaceScoped.extend({
  proceedingId: z.uuid(),
  sourceId: z.string().min(1).max(100),
  cnr: z.string().trim().max(30).nullable().optional(),
  caseNumber: z.string().trim().max(100).nullable().optional(),
  cadenceMinutes: z.int().min(60).max(10080).optional(),
});
const WatchInput = WorkspaceScoped.extend({ watchId: z.uuid() });
const DeviceInput = WatchInput.extend({ status: ParsedCaseStatusSchema });

const listWatches = workspaceAction(
  WorkspaceScoped,
  async (_input, ctx): Promise<CaseWatchView[]> => {
    await requireFlag(ctx);
    const { listCaseWatches } = await import('@causedeck/core/case-watch');
    return (await listCaseWatches({ db: ctx.tx }, actorOf(ctx))).map(toView);
  },
  { action: 'matter.write' },
);

// authz: requireSession + workspace membership + `matter.write` in workspaceAction; core lists the
// caller's own watches in this workspace only.
export async function listCaseWatchesAction(raw: unknown): Promise<Result<CaseWatchView[]>> {
  return listWatches(raw);
}

const addWatch = workspaceAction(
  AddInput,
  async (input, ctx): Promise<CaseWatchView> => {
    await requireFlag(ctx);
    const { addCaseWatch, STATUS_SOURCES } = await import('@causedeck/core/case-watch');
    if (!Object.hasOwn(STATUS_SOURCES, input.sourceId)) {
      throw new ActionError('VALIDATION', 'This source has no status lookup');
    }
    const row = await guarded(() =>
      addCaseWatch({ db: ctx.tx }, actorOf(ctx), {
        proceedingId: input.proceedingId,
        sourceId: input.sourceId,
        cnr: input.cnr ?? null,
        caseNumber: input.caseNumber ?? null,
        ...(input.cadenceMinutes === undefined ? {} : { cadenceMinutes: input.cadenceMinutes }),
      }),
    );
    revalidate();
    return toView(row);
  },
  { action: 'matter.write' },
);

// authz: requireSession + workspace membership + `matter.write` in workspaceAction; core writes the
// watch under the caller's own user, only on a proceeding whose matter the caller can read.
export async function addCaseWatchAction(raw: unknown): Promise<Result<CaseWatchView>> {
  return addWatch(raw);
}

const removeWatch = workspaceAction(
  WatchInput,
  async (input, ctx): Promise<{ removed: true }> => {
    await requireFlag(ctx);
    const { removeCaseWatch } = await import('@causedeck/core/case-watch');
    await guarded(() => removeCaseWatch({ db: ctx.tx }, actorOf(ctx), input.watchId));
    revalidate();
    return { removed: true };
  },
  { action: 'matter.write' },
);

// authz: requireSession + workspace membership + `matter.write` in workspaceAction; core removes
// only the caller's own watch (another's id is NOT_FOUND).
export async function removeCaseWatchAction(raw: unknown): Promise<Result<{ removed: true }>> {
  return removeWatch(raw);
}

const refresh = workspaceAction(
  WatchInput,
  async (input, ctx): Promise<CaseStatusRefreshed> => {
    await requireFlag(ctx);
    const { runCaseStatusLookup } = await import('@causedeck/core/case-watch');
    const { fetcher, provenance } = webStatusFetcher(ctx.tx);
    const report = await guarded(() =>
      runCaseStatusLookup({ db: ctx.tx, fetcher }, actorOf(ctx), { watchId: input.watchId }),
    );
    const used = provenance();
    revalidate();
    return {
      outcome: report.outcome,
      proposals: report.proposals,
      tierUsed: used?.tierUsed ?? null,
      costDollars: used?.costDollars ?? 0,
    };
  },
  { action: 'matter.write' },
);

// authz: requireSession + workspace membership + `matter.write` in workspaceAction; core runs the
// lookup only for the caller's own watch, always delegated for the caller and the watched matter.
export async function refreshCaseStatusAction(raw: unknown): Promise<Result<CaseStatusRefreshed>> {
  return refresh(raw);
}

const recordDevice = workspaceAction(
  DeviceInput,
  async (input, ctx): Promise<DeviceStatusRecorded> => {
    await requireFlag(ctx);
    const { recordDeviceSnapshot } = await import('@causedeck/core/case-watch');
    const report = await guarded(() =>
      recordDeviceSnapshot({ db: ctx.tx }, actorOf(ctx), {
        watchId: input.watchId,
        status: input.status,
      }),
    );
    revalidate();
    return { outcome: report.outcome, proposals: report.proposals };
  },
  { action: 'matter.write' },
);

// authz: requireSession + workspace membership + `matter.write` in workspaceAction; the status body
// is validated against the parsed-status schema and core stores it only on the caller's own watch.
export async function recordDeviceStatusAction(raw: unknown): Promise<Result<DeviceStatusRecorded>> {
  return recordDevice(raw);
}
