'use server';
// Roster server actions (#434, part 1 of #391), each through `workspaceAction`
// (lib/workspace-action.ts): zod input, `requireSession`, membership and the policy action.
//   previewRosterImportAction       a finalized upload (`/api/uploads`) + forum code → the parsed
//                                   roster preview; `workspace.manage` (owners and advocates)
//   confirmRosterImportAction       confirm the reviewed roster, then detect bench changes for it;
//                                   `workspace.manage`; CONFLICT over an active roster unless
//                                   `supersedeCurrent` is set
//   dismissBenchChangeAlertAction   dismiss an alert on a matter the member may read; `matter.write`
// Preview and confirm run through `@causedeck/core/runtime` on their own connection: the confirmed
// roster commits before detection notifies and enqueues deliveries. Another workspace's blob,
// forum or alert under the caller's own workspace is NOT_FOUND.
import { assertCan } from '@causedeck/auth/policy';
import { FORUM_CODE_PATTERN } from '@causedeck/validators/forum';
import { ConfirmedRosterEntrySchema } from '@causedeck/validators/roster';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type Result } from '../../../../../../lib/safe-action.ts';
import { objectStore } from '../../../../../../lib/storage.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

const DAY = z.iso.date();

const PreviewRosterImport = WorkspaceScoped.extend({
  blobId: z.uuid(),
  forumCode: z.string().trim().regex(FORUM_CODE_PATTERN),
});

const ConfirmRosterImport = WorkspaceScoped.extend({
  forumId: z.uuid(),
  effectiveFrom: DAY,
  effectiveTo: DAY.optional(),
  sourceDocumentId: z.uuid().optional(),
  note: z.string().trim().min(1).max(500).optional(),
  entries: z.array(ConfirmedRosterEntrySchema).min(1),
  supersedeCurrent: z.boolean().optional(),
});

const DismissBenchChangeAlert = WorkspaceScoped.extend({ alertId: z.uuid() });

export interface RosterPreviewResult {
  forumCode: string;
  effectiveFrom: { date: string; anchor: unknown } | null;
  effectiveFromRequired: boolean;
  candidates: {
    hallNo: string;
    judges: string[];
    portfolioText: string;
    confidence: number;
    anchor: unknown;
  }[];
}

export interface ConfirmedRosterResult {
  rosterId: string;
  version: number;
  effectiveFrom: string;
  alertsCreated: number;
  /** `failed` when the roster was confirmed but detection did not finish; it can be re-run. */
  detection: 'ok' | 'failed';
}

export interface DismissedAlert {
  alertId: string;
  status: 'open' | 'dismissed';
}

const ROSTERS_PATH = '/w/[slug]/courts/rosters';

const preview = workspaceAction(
  PreviewRosterImport,
  async (input, ctx): Promise<RosterPreviewResult> => {
    assertCan(ctx.actor, 'workspace.manage');
    const { previewRosterImportFor } = await import('@causedeck/core/runtime');
    return previewRosterImportFor(
      { workspaceId: ctx.workspaceId, userId: ctx.userId, store: objectStore() },
      { blobId: input.blobId, forumCode: input.forumCode },
    );
  },
  { action: 'workspace.manage' },
);

const confirm = workspaceAction(
  ConfirmRosterImport,
  async (input, ctx): Promise<ConfirmedRosterResult> => {
    assertCan(ctx.actor, 'workspace.manage');
    const { forumId, effectiveFrom, entries, effectiveTo, sourceDocumentId, note } = input;
    const { confirmRosterImportFor } = await import('@causedeck/core/runtime');
    const confirmed = await confirmRosterImportFor(
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      {
        forumId,
        effectiveFrom,
        entries,
        ...(input.supersedeCurrent === undefined
          ? {}
          : { supersedeCurrent: input.supersedeCurrent }),
        ...(effectiveTo === undefined ? {} : { effectiveTo }),
        ...(sourceDocumentId === undefined ? {} : { sourceDocumentId }),
        ...(note === undefined ? {} : { note }),
      },
    );
    revalidatePath(ROSTERS_PATH, 'page');
    return {
      rosterId: confirmed.roster.roster.id,
      version: confirmed.roster.roster.version,
      effectiveFrom: confirmed.roster.roster.effectiveFrom,
      alertsCreated: confirmed.alerts.length,
      detection: confirmed.detection,
    };
  },
  { action: 'workspace.manage' },
);

const dismiss = workspaceAction(
  DismissBenchChangeAlert,
  async (input, ctx): Promise<DismissedAlert> => {
    const { dismissAlert } = await import('@causedeck/core/court');
    const row = await dismissAlert(
      ctx.tx,
      { userId: ctx.userId, workspaceId: ctx.workspaceId },
      { alertId: input.alertId },
    );
    revalidatePath(ROSTERS_PATH, 'page');
    return { alertId: row.id, status: row.status };
  },
  { action: 'matter.write' },
);

export async function previewRosterImportAction(
  raw: unknown,
): Promise<Result<RosterPreviewResult>> {
  return preview(raw);
}

export async function confirmRosterImportAction(
  raw: unknown,
): Promise<Result<ConfirmedRosterResult>> {
  return confirm(raw);
}

export async function dismissBenchChangeAlertAction(raw: unknown): Promise<Result<DismissedAlert>> {
  return dismiss(raw);
}
