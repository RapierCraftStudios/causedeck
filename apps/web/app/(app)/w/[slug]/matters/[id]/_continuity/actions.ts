'use server';
// Continuity server actions (#71): the handover note and what-changed. Each goes through
// `workspaceAction` (zod input, session, membership, the policy action) and the core continuity
// services on the workspace transaction; the services decide again per matter and role. Internal
// only: there is no share, email or export action here.
import {
  AcknowledgeHandoverInput,
  GenerateHandoverInput,
  ListHandoversInput,
  RecordViewInput,
  SaveHandoverInput,
  WhatChangedInput,
  type ChangeSummary,
  type HandoverBody,
  type HandoverNote,
  type ViewMarker,
} from '@causedeck/validators';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { domainErrorCode } from '../../../../../../../lib/matters/graph-deps.ts';
import { ActionError, type Result } from '../../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../../lib/workspace-action.ts';

/** A domain refusal keeps its code; anything else is rethrown for the generic mapping. */
function toActionError(error: unknown): never {
  const code = domainErrorCode(error);
  if (
    error instanceof Error &&
    (code === 'VALIDATION' || code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'CONFLICT')
  ) {
    throw new ActionError(code, error.message);
  }
  throw error;
}

const scopeOf = (ctx: { workspaceId: string; userId: string }) => ({
  workspaceId: ctx.workspaceId,
  userId: ctx.userId,
});

const generate = workspaceAction(
  WorkspaceScoped.extend(GenerateHandoverInput.shape),
  async ({ matterId }, ctx) => {
    const { generateHandover } = await import('@causedeck/core/continuity');
    try {
      return await generateHandover({ db: ctx.tx }, scopeOf(ctx), matterId);
    } catch (error) {
      return toActionError(error);
    }
  },
  { action: 'matter.read' },
);

export async function generateHandoverAction(raw: unknown): Promise<Result<HandoverBody>> {
  return generate(raw);
}

const save = workspaceAction(
  z.intersection(WorkspaceScoped, SaveHandoverInput),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the scope comes from ctx
  async ({ workspaceId: _workspaceId, ...input }, ctx) => {
    const { saveHandover } = await import('@causedeck/core/continuity');
    try {
      const note = await saveHandover({ db: ctx.tx }, scopeOf(ctx), input);
      revalidatePath('/w/[slug]/matters/[id]', 'page');
      return note;
    } catch (error) {
      return toActionError(error);
    }
  },
  { action: 'task.write' },
);

export async function saveHandoverAction(raw: unknown): Promise<Result<HandoverNote>> {
  return save(raw);
}

const list = workspaceAction(
  WorkspaceScoped.extend(ListHandoversInput.shape),
  async ({ matterId }, ctx) => {
    const { listHandovers } = await import('@causedeck/core/continuity');
    try {
      return await listHandovers({ db: ctx.tx }, scopeOf(ctx), { matterId });
    } catch (error) {
      return toActionError(error);
    }
  },
  { action: 'matter.read' },
);

export async function listHandoversAction(raw: unknown): Promise<Result<HandoverNote[]>> {
  return list(raw);
}

const acknowledge = workspaceAction(
  WorkspaceScoped.extend(AcknowledgeHandoverInput.shape),
  async ({ handoverId }, ctx) => {
    const { acknowledgeHandover } = await import('@causedeck/core/continuity');
    try {
      const note = await acknowledgeHandover({ db: ctx.tx }, scopeOf(ctx), { handoverId });
      revalidatePath('/w/[slug]/matters/[id]', 'page');
      return note;
    } catch (error) {
      return toActionError(error);
    }
  },
  { action: 'matter.read' },
);

export async function acknowledgeHandoverAction(raw: unknown): Promise<Result<HandoverNote>> {
  return acknowledge(raw);
}

const record = workspaceAction(
  WorkspaceScoped.extend(RecordViewInput.shape),
  async ({ matterId }, ctx) => {
    const { recordView } = await import('@causedeck/core/continuity');
    try {
      return await recordView({ db: ctx.tx }, scopeOf(ctx), { matterId });
    } catch (error) {
      return toActionError(error);
    }
  },
  { action: 'matter.read' },
);

export async function recordViewAction(raw: unknown): Promise<Result<ViewMarker>> {
  return record(raw);
}

const changed = workspaceAction(
  WorkspaceScoped.extend(WhatChangedInput.shape),
  async ({ matterId, since }, ctx) => {
    const { whatChangedSince } = await import('@causedeck/core/continuity');
    try {
      return await whatChangedSince({ db: ctx.tx }, scopeOf(ctx), matterId, since);
    } catch (error) {
      return toActionError(error);
    }
  },
  { action: 'matter.read' },
);

export async function whatChangedAction(raw: unknown): Promise<Result<ChangeSummary>> {
  return changed(raw);
}
