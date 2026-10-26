'use server';
// Enquiry server actions (#874, #87 part 2). Each goes through `workspaceAction`: zod input,
// `requireSession`, membership and the advocate-level policy action (`enquiry.write`), so a clerk,
// junior or viewer gets FORBIDDEN and a non-member FORBIDDEN before anything runs. The legal-gated
// `intake.enquiry_log` flag is read first: off means NOT_FOUND, as if the feature did not exist (the
// core services would answer FORBIDDEN, which would reveal it). Nothing here sends anything.
// - `logEnquiryAction`: record an enquiry with the parties to check.
// - `updateEnquiryAction`: edit it, or mark it declined or referred.
// - `runConflictCheckAction`: the ranked hits against the chamber's matters; never a verdict.
// - `acceptEnquiryAction`: stage a `new_matter` proposal (the advocate approves it in the inbox).
// - `closeEnquiryAction`: close it, with an optional reason.
import {
  AcceptEnquiryInput,
  CloseEnquiryInput,
  EnquiryIdInput,
  LogEnquiryInput,
  UpdateEnquiryInput,
} from '@causedeck/validators/enquiry';
import { revalidatePath } from 'next/cache';

import {
  intakeDeps,
  toConflictCheckView,
  type ConflictCheckView,
} from '../../../../../../lib/intake/intake-deps.ts';
import { ActionError, type Result } from '../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../lib/workspace-action.ts';

function actorOf(ctx: WorkspaceActionCtx) {
  return { workspaceId: ctx.workspaceId, userId: ctx.userId };
}

/** The input without `workspaceId`, which the services take from the actor (they are strict). */
function omitWorkspace<T extends { workspaceId: string }>(input: T): Omit<T, 'workspaceId'> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'workspaceId')) as Omit<
    T,
    'workspaceId'
  >;
}

async function requireFlag(ctx: WorkspaceActionCtx): Promise<void> {
  const { isEnabled } = await import('@causedeck/flags/server');
  const on = await isEnabled('intake.enquiry_log', {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
  });
  if (!on) throw new ActionError('NOT_FOUND', '');
}

function revalidateEnquiries(): void {
  revalidatePath('/w/[slug]/people/enquiries', 'page');
}

/** What a mutation returns: the id and the status, never the contact details. */
export interface SavedEnquiry {
  id: string;
  status: string;
}

const OPTIONS = { action: 'enquiry.write' } as const;

const log = workspaceAction(
  WorkspaceScoped.extend(LogEnquiryInput.shape),
  async (input, ctx) => {
    await requireFlag(ctx);
    const { logEnquiry } = await import('@causedeck/core/intake');
    const row = await logEnquiry(intakeDeps(ctx.tx), actorOf(ctx), omitWorkspace(input));
    revalidateEnquiries();
    return { id: row.id, status: row.status };
  },
  OPTIONS,
);

export async function logEnquiryAction(raw: unknown): Promise<Result<SavedEnquiry>> {
  return log(raw);
}

const update = workspaceAction(
  WorkspaceScoped.extend(UpdateEnquiryInput.shape),
  async (input, ctx) => {
    await requireFlag(ctx);
    const { updateEnquiry } = await import('@causedeck/core/intake');
    const row = await updateEnquiry(intakeDeps(ctx.tx), actorOf(ctx), omitWorkspace(input));
    revalidateEnquiries();
    return { id: row.id, status: row.status };
  },
  OPTIONS,
);

export async function updateEnquiryAction(raw: unknown): Promise<Result<SavedEnquiry>> {
  return update(raw);
}

const check = workspaceAction(
  WorkspaceScoped.extend(EnquiryIdInput.shape),
  async (input, ctx): Promise<ConflictCheckView> => {
    await requireFlag(ctx);
    const { runConflictCheck } = await import('@causedeck/core/intake');
    const result = await runConflictCheck(intakeDeps(ctx.tx), actorOf(ctx), omitWorkspace(input));
    revalidateEnquiries();
    return toConflictCheckView(result);
  },
  OPTIONS,
);

export async function runConflictCheckAction(raw: unknown): Promise<Result<ConflictCheckView>> {
  return check(raw);
}

const accept = workspaceAction(
  WorkspaceScoped.extend(AcceptEnquiryInput.shape),
  async (input, ctx) => {
    await requireFlag(ctx);
    const { acceptEnquiry } = await import('@causedeck/core/intake');
    const row = await acceptEnquiry(intakeDeps(ctx.tx), actorOf(ctx), omitWorkspace(input));
    revalidateEnquiries();
    return { id: row.id, status: row.status };
  },
  OPTIONS,
);

export async function acceptEnquiryAction(raw: unknown): Promise<Result<SavedEnquiry>> {
  return accept(raw);
}

const close = workspaceAction(
  WorkspaceScoped.extend(CloseEnquiryInput.shape),
  async (input, ctx) => {
    await requireFlag(ctx);
    const { closeEnquiry } = await import('@causedeck/core/intake');
    const row = await closeEnquiry(intakeDeps(ctx.tx), actorOf(ctx), omitWorkspace(input));
    revalidateEnquiries();
    return { id: row.id, status: row.status };
  },
  OPTIONS,
);

export async function closeEnquiryAction(raw: unknown): Promise<Result<SavedEnquiry>> {
  return close(raw);
}
