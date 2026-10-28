'use server';
// Client status link server actions (#88, ADR 0049). Each goes through `workspaceAction` (zod input,
// session, membership); the core services decide the role again (advocate or owner only). The
// legal-gated `status_links.enabled` flag is read first: off means NOT_FOUND, as if the feature did
// not exist. Nothing here sends anything: `createStatusLinkAction` returns the URL once and the
// advocate shares it themselves.
import { StatusLinkExtend, StatusLinkInput } from '@causedeck/validators/status-link';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { domainErrorCode } from '../../../../../../../lib/matters/graph-deps.ts';
import { serverEnv } from '../../../../../../../lib/env.ts';
import { ActionError, type Result } from '../../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../../lib/workspace-action.ts';

const OPTIONS = { action: 'matter.read' } as const;

const actorOf = (ctx: WorkspaceActionCtx) => ({ workspaceId: ctx.workspaceId, userId: ctx.userId });

async function requireFlag(ctx: WorkspaceActionCtx): Promise<void> {
  const { isEnabled } = await import('@causedeck/flags/server');
  const on = await isEnabled('status_links.enabled', {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
  });
  if (!on) throw new ActionError('NOT_FOUND', '');
}

/** A domain refusal keeps its code; core's `FeatureDisabledError` is a backstop and reads as FORBIDDEN. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && error.name === 'FeatureDisabledError') {
      throw new ActionError('FORBIDDEN', '');
    }
    const code = domainErrorCode(error);
    if (
      error instanceof Error &&
      (code === 'VALIDATION' || code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'CONFLICT')
    ) {
      throw new ActionError(code, error.message);
    }
    throw error;
  }
}

function withoutWorkspace<T extends { workspaceId: string }>(input: T): Omit<T, 'workspaceId'> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'workspaceId')) as Omit<
    T,
    'workspaceId'
  >;
}

const revalidate = (): void => {
  revalidatePath('/w/[slug]/matters/[id]', 'page');
};

/** The base the full URL is built on: the app origin (`APP_URL`). */
function baseUrl(): string {
  return serverEnv().APP_URL;
}

export interface CreatedLinkView {
  id: string;
  url: string;
  expiresAt: string;
}

const create = workspaceAction(
  WorkspaceScoped.extend(StatusLinkInput.shape),
  async (input, ctx): Promise<CreatedLinkView> => {
    await requireFlag(ctx);
    const { createStatusLink } = await import('@causedeck/core/status-links');
    const created = await guarded(() =>
      createStatusLink({ db: ctx.tx, baseUrl: baseUrl() }, actorOf(ctx), withoutWorkspace(input)),
    );
    revalidate();
    return { id: created.id, url: created.url, expiresAt: created.expiresAt.toISOString() };
  },
  OPTIONS,
);

export async function createStatusLinkAction(raw: unknown): Promise<Result<CreatedLinkView>> {
  return create(raw);
}

const revoke = workspaceAction(
  WorkspaceScoped.extend({ linkId: z.uuid() }),
  async ({ linkId }, ctx): Promise<{ id: string }> => {
    await requireFlag(ctx);
    const { revokeStatusLink } = await import('@causedeck/core/status-links');
    await guarded(() => revokeStatusLink({ db: ctx.tx }, actorOf(ctx), linkId));
    revalidate();
    return { id: linkId };
  },
  OPTIONS,
);

export async function revokeStatusLinkAction(raw: unknown): Promise<Result<{ id: string }>> {
  return revoke(raw);
}

const extend = workspaceAction(
  WorkspaceScoped.extend(StatusLinkExtend.shape),
  async (input, ctx): Promise<{ expiresAt: string }> => {
    await requireFlag(ctx);
    const { extendStatusLink } = await import('@causedeck/core/status-links');
    const result = await guarded(() =>
      extendStatusLink({ db: ctx.tx }, actorOf(ctx), withoutWorkspace(input)),
    );
    revalidate();
    return { expiresAt: result.expiresAt.toISOString() };
  },
  OPTIONS,
);

export async function extendStatusLinkAction(raw: unknown): Promise<Result<{ expiresAt: string }>> {
  return extend(raw);
}

export interface StatusLinkListItem {
  id: string;
  headline: string;
  state: 'active' | 'expired' | 'revoked';
  expiresAt: string;
  views: number;
}

const list = workspaceAction(
  WorkspaceScoped.extend({ matterId: z.uuid() }),
  async ({ matterId }, ctx): Promise<StatusLinkListItem[]> => {
    await requireFlag(ctx);
    const { listStatusLinks } = await import('@causedeck/core/status-links');
    const rows = await guarded(() => listStatusLinks({ db: ctx.tx }, actorOf(ctx), matterId));
    return rows.map((r) => ({
      id: r.id,
      headline: r.headline,
      state: r.state,
      expiresAt: r.expiresAt.toISOString(),
      views: r.views,
    }));
  },
  OPTIONS,
);

export async function listStatusLinksAction(raw: unknown): Promise<Result<StatusLinkListItem[]>> {
  return list(raw);
}

const prefill = workspaceAction(
  WorkspaceScoped.extend({ draftId: z.uuid() }),
  async ({ draftId }, ctx) => {
    await requireFlag(ctx);
    const { prefillFromDraft } = await import('@causedeck/core/status-links');
    return guarded(() => prefillFromDraft({ db: ctx.tx }, actorOf(ctx), draftId));
  },
  OPTIONS,
);

export async function prefillStatusLinkAction(
  raw: unknown,
): Promise<Result<{ matterId: string; note: string; language: 'en' | 'ta' | 'kn' }>> {
  return prefill(raw);
}
