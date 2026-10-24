'use server';
// Matter workspace server actions (#390, #40 part 3). Each goes through `workspaceAction`
// (lib/workspace-action.ts): zod input, `requireSession`, membership and the policy action asserted
// by `guard`, so a non-member (another workspace's owner included) gets FORBIDDEN before anything
// runs. The matter-graph services run on the workspace-scoped transaction `ctx.tx` and decide again
// with `can()` per matter (a junior's unassigned matter, a restricted matter), returning NOT_FOUND,
// FORBIDDEN, CONFLICT or VALIDATION through `toActionError`.
// - `updateMatterAction` (`matter.write`): the title and the lawyer's synopsis (provenance
//   `manual`). Never the sensitive flag or the owner: those have their own guarded paths.
// - `setSensitiveAction` (`matter.restrict`, owners and advocates): the sensitive flag (CA-10).
// - `confirmNextDateAction` (`matter.write`): confirm a `proposed` next date.
// - `chooseNextDateSourceAction` (`matter.write`): resolve a conflict card as the person chose.
// - `reportRecordErrorAction` (`matter.read`): tell CauseDeck review a fetched value is wrong, with
//   consent to share the record; only a case the workspace watches can be reported (#518).
import { REVIEW_FIELDS } from '@causedeck/db/schema';
import { NEXT_DATE_CHOICES } from '@causedeck/validators/matter-graph-inputs';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { graphDeps } from '../../../../../../lib/matters/graph-deps.ts';
import type { Result } from '../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../lib/workspace-action.ts';

/** Synopsis length cap: a few paragraphs, not a document. */
const SYNOPSIS_MAX = 20_000;

function actorOf(ctx: WorkspaceActionCtx) {
  return { workspaceId: ctx.workspaceId, userId: ctx.userId };
}

function revalidateMatter(): void {
  revalidatePath('/w/[slug]/matters/[id]', 'layout');
  revalidatePath('/w/[slug]/matters', 'page');
}

const UpdateMatter = WorkspaceScoped.extend({
  matterId: z.uuid(),
  patch: z
    .strictObject({
      title: z.string().trim().min(1).max(500).optional(),
      synopsis: z.string().max(SYNOPSIS_MAX).nullable().optional(),
    })
    .refine((patch) => patch.title !== undefined || patch.synopsis !== undefined, {
      message: 'Change at least one field',
    }),
});

export interface UpdatedMatter {
  id: string;
  title: string;
  synopsis: string | null;
}

const update = workspaceAction(
  UpdateMatter,
  async (input, ctx) => {
    const { updateMatter } = await import('@causedeck/core/matter-graph');
    const { title, synopsis } = input.patch;
    // An empty synopsis clears it.
    const text = synopsis === undefined || synopsis === null ? synopsis : synopsis.trim();
    const row = await updateMatter(graphDeps(ctx.tx), actorOf(ctx), {
      matterId: input.matterId,
      patch: {
        ...(title === undefined ? {} : { title }),
        ...(text === undefined ? {} : { synopsis: text === '' ? null : text }),
      },
    });
    revalidateMatter();
    return { id: row.id, title: row.title, synopsis: row.synopsis };
  },
  { action: 'matter.write' },
);

export async function updateMatterAction(raw: unknown): Promise<Result<UpdatedMatter>> {
  return update(raw);
}

const SetSensitive = WorkspaceScoped.extend({ matterId: z.uuid(), sensitive: z.boolean() });

const sensitive = workspaceAction(
  SetSensitive,
  async (input, ctx) => {
    const { setSensitive } = await import('@causedeck/core/matter-graph');
    const row = await setSensitive(graphDeps(ctx.tx), actorOf(ctx), {
      matterId: input.matterId,
      sensitive: input.sensitive,
    });
    revalidateMatter();
    return { id: row.id, sensitive: row.sensitive };
  },
  { action: 'matter.restrict' },
);

export async function setSensitiveAction(
  raw: unknown,
): Promise<Result<{ id: string; sensitive: boolean }>> {
  return sensitive(raw);
}

export interface ChosenNextDate {
  listingId: string;
  date: string;
  confirmationState: string;
}

const ConfirmNextDate = WorkspaceScoped.extend({ listingId: z.uuid() });

const confirm = workspaceAction(
  ConfirmNextDate,
  async (input, ctx) => {
    const { confirmNextDate } = await import('@causedeck/core/matter-graph');
    const row = await confirmNextDate(graphDeps(ctx.tx), actorOf(ctx), {
      listingId: input.listingId,
      allowPast: false,
    });
    revalidateMatter();
    return { listingId: row.id, date: row.listDate, confirmationState: row.confirmationState };
  },
  { action: 'matter.write' },
);

export async function confirmNextDateAction(raw: unknown): Promise<Result<ChosenNextDate>> {
  return confirm(raw);
}

const ChooseNextDateSource = WorkspaceScoped.extend({
  currentListingId: z.uuid(),
  proposedListingId: z.uuid(),
  choice: z.enum(NEXT_DATE_CHOICES),
  date: z.iso.date().optional(),
}).superRefine((value, ctx) => {
  if (value.choice === 'manual' && value.date === undefined) {
    ctx.addIssue({ code: 'custom', path: ['date'], message: 'Enter the next date' });
  }
  if (value.choice !== 'manual' && value.date !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['date'], message: 'Only a manual choice takes a date' });
  }
});

const choose = workspaceAction(
  ChooseNextDateSource,
  async (input, ctx) => {
    const { chooseNextDateSource } = await import('@causedeck/core/matter-graph');
    const row = await chooseNextDateSource(graphDeps(ctx.tx), actorOf(ctx), {
      currentListingId: input.currentListingId,
      proposedListingId: input.proposedListingId,
      choice: input.choice,
      ...(input.date === undefined ? {} : { date: input.date }),
    });
    revalidateMatter();
    return { listingId: row.id, date: row.listDate, confirmationState: row.confirmationState };
  },
  { action: 'matter.write' },
);

export async function chooseNextDateSourceAction(raw: unknown): Promise<Result<ChosenNextDate>> {
  return choose(raw);
}

const ReportRecordError = WorkspaceScoped.extend({
  proceedingId: z.uuid(),
  field: z.enum(REVIEW_FIELDS),
  shownValue: z.string().trim().max(200),
  reportedValue: z.string().trim().min(1).max(200),
  consent: z.literal(true),
});

const report = workspaceAction(
  ReportRecordError,
  async (input, ctx) => {
    const { reportRecordError } = await import('@causedeck/core/review');
    return reportRecordError(ctx.tx, actorOf(ctx), {
      proceedingId: input.proceedingId,
      field: input.field,
      shownValue: input.shownValue,
      reportedValue: input.reportedValue,
      consent: input.consent,
    });
  },
  { action: 'matter.read' },
);

export async function reportRecordErrorAction(raw: unknown): Promise<Result<{ id: string }>> {
  return report(raw);
}
