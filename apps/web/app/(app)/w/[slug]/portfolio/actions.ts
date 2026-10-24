'use server';
// Portfolio server actions (#666, part 6 of #498), each through `workspaceAction`
// (lib/workspace-action.ts): zod input, `requireSession`, membership and the policy action.
//   createPortfolioAction      create a portfolio; `workspace.manage`, owners only in core
//   importPortfolioAction      import a CSV of CNRs or case numbers (max 1,000 rows) into a
//                              portfolio; `workspace.manage`, owners only in core. Creates the
//                              delegated watches; never a fetch and never bulk captcha (#663)
//   exportPortfolioCsvAction   a portfolio's cases as CSV text; any active member
// The domain (`@causedeck/core/portfolio`) runs on the workspace-scoped transaction `ctx.tx`;
// another workspace's portfolio id is NOT_FOUND.
import { assertCan } from '@causedeck/auth/policy';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type Result } from '../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../lib/workspace-action.ts';

/** A CSV of 1,000 rows is well under this; a larger body is refused before parsing. */
export const MAX_PORTFOLIO_CSV_CHARS = 512_000;

const CreatePortfolio = WorkspaceScoped.extend({ name: z.string().trim().min(1).max(200) });

const ImportPortfolio = WorkspaceScoped.extend({
  portfolioId: z.uuid(),
  csv: z.string().min(1).max(MAX_PORTFOLIO_CSV_CHARS),
  sourceId: z.string().trim().min(1).max(200).optional(),
});

const ExportPortfolio = WorkspaceScoped.extend({ portfolioId: z.uuid() });

export interface CreatedPortfolio {
  id: string;
  name: string;
}

export interface PortfolioImportResult {
  created: number;
  duplicates: number;
  invalid: number;
  errors: { line: number; message: string }[];
  watched: number;
  unwatched: number;
}

export interface PortfolioExportResult {
  filename: string;
  csv: string;
}

const PORTFOLIO_PATH = '/w/[slug]/portfolio';

const create = workspaceAction(
  CreatePortfolio,
  async (input, ctx): Promise<CreatedPortfolio> => {
    assertCan(ctx.actor, 'workspace.manage');
    const { createPortfolio } = await import('@causedeck/core/portfolio');
    const row = await createPortfolio(
      { db: ctx.tx },
      { userId: ctx.userId, workspaceId: ctx.workspaceId },
      { name: input.name },
    );
    revalidatePath(PORTFOLIO_PATH, 'page');
    return { id: row.id, name: row.name };
  },
  { action: 'workspace.manage' },
);

const importCases = workspaceAction(
  ImportPortfolio,
  async (input, ctx): Promise<PortfolioImportResult> => {
    assertCan(ctx.actor, 'workspace.manage');
    const { importPortfolioCases } = await import('@causedeck/core/portfolio');
    const report = await importPortfolioCases(
      { db: ctx.tx },
      { userId: ctx.userId, workspaceId: ctx.workspaceId },
      {
        portfolioId: input.portfolioId,
        csv: input.csv,
        ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
      },
    );
    revalidatePath(PORTFOLIO_PATH, 'page');
    return {
      created: report.created,
      duplicates: report.duplicates,
      invalid: report.invalid,
      errors: report.errors.map((e) => ({ line: e.line, message: e.message })),
      watched: report.watched,
      unwatched: report.unwatched,
    };
  },
  { action: 'workspace.manage' },
);

const exportCsv = workspaceAction(
  ExportPortfolio,
  async (input, ctx): Promise<PortfolioExportResult> => {
    const { exportPortfolioCsv } = await import('@causedeck/core/portfolio');
    const csv = await exportPortfolioCsv(
      { db: ctx.tx },
      { userId: ctx.userId, workspaceId: ctx.workspaceId },
      { portfolioId: input.portfolioId },
    );
    return { filename: `portfolio-${input.portfolioId}.csv`, csv };
  },
);

// A `'use server'` module may only export async functions, so each action is wrapped.
export async function createPortfolioAction(raw: unknown): Promise<Result<CreatedPortfolio>> {
  return create(raw);
}

export async function importPortfolioAction(raw: unknown): Promise<Result<PortfolioImportResult>> {
  return importCases(raw);
}

export async function exportPortfolioCsvAction(
  raw: unknown,
): Promise<Result<PortfolioExportResult>> {
  return exportCsv(raw);
}
