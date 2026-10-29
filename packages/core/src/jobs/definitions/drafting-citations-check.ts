// `drafting.citations.check` (#77): resolves the citations of one draft version and stores one
// `authority` row each (`checkDraft`), then emits `draft.citations.checked` (the audit event written
// by the service). The payload is ids only. Singleton per version; a rerun resolves only the
// citations still open, so a retry never repeats an answered one. While the resolver is unavailable
// the rows are left `unknown` with reason `resolver_unavailable` and the job fails retryably with
// backoff until its last attempt, which keeps that state and completes. A missing version or a
// workspace error cannot succeed on retry. Logs carry ids and counts, never draft text.
import { serverEnv } from '@causedeck/config/env';
import { db as rootDb, type Database, type Transaction } from '@causedeck/db';
import {
  createIndianKanoonResolver,
  createMockResolver,
  createRateLimiter,
  type CitationResolver,
  type RateLimiter,
} from '@causedeck/drafting';
import type { CitationReport } from '@causedeck/validators/citation';
import { z } from 'zod';

import { checkDraft } from '../../drafting/index.ts';
import { WorkspaceError } from '../../shared/errors.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { PermanentError, RetryableError } from '../errors.ts';
import { getProducer } from '../producer.ts';

export const draftingCitationsCheckSchema = z.object({
  workspaceId: workspaceIdSchema,
  draftVersionId: z.uuid(),
});

export type DraftingCitationsCheckPayload = z.output<typeof draftingCitationsCheckSchema>;

/** Retries after the first attempt. */
export const DRAFTING_CITATIONS_RETRIES = 3;

/** External resolver calls one workspace may make per IST day. */
export const CITATION_DAILY_BUDGET = 500;

export interface DraftingCitationsCheckDeps {
  db?: Database | Transaction;
  resolver?: CitationResolver;
  limiter?: RateLimiter;
  dailyBudget?: number;
  now?: () => Date;
}

let defaultLimiter: RateLimiter | undefined;

/** The mock unless `CITATION_RESOLVER=indian-kanoon` (which needs its token). */
function resolverFromEnv(): CitationResolver {
  const env = serverEnv();
  return env.CITATION_RESOLVER === 'indian-kanoon'
    ? createIndianKanoonResolver({ token: env.INDIAN_KANOON_API_TOKEN.reveal() })
    : createMockResolver();
}

/** The job body. Exported for tests. */
export async function runDraftingCitationsCheck(
  ctx: Pick<JobContext, 'log' | 'attempt'>,
  payload: DraftingCitationsCheckPayload,
  deps: DraftingCitationsCheckDeps = {},
): Promise<CitationReport> {
  let report: CitationReport;
  try {
    report = await checkDraft(
      {
        db: deps.db ?? rootDb,
        resolver: deps.resolver ?? resolverFromEnv(),
        limiter: deps.limiter ?? (defaultLimiter ??= createRateLimiter()),
        dailyBudget: deps.dailyBudget ?? CITATION_DAILY_BUDGET,
        log: ctx.log,
        ...(deps.now ? { now: deps.now } : {}),
      },
      { workspaceId: payload.workspaceId, system: true },
      payload.draftVersionId,
    );
  } catch (error) {
    if (error instanceof WorkspaceError) {
      throw new PermanentError('DRAFT_CITATIONS_REFUSED', error.code, { cause: error });
    }
    throw error;
  }
  const unavailable = report.items.filter((i) => i.reason === 'resolver_unavailable').length;
  if (unavailable > 0 && ctx.attempt <= DRAFTING_CITATIONS_RETRIES) {
    throw new RetryableError('CITATION_RESOLVER_UNAVAILABLE');
  }
  return report;
}

/** Send one `drafting.citations.check` job as the registry's `enqueue` does. */
export async function enqueueDraftingCitationCheck(
  job: DraftingCitationsCheckPayload,
): Promise<unknown> {
  const data = draftingCitationsCheckSchema.parse(job);
  const sender = await getProducer();
  return sender.send('drafting.citations.check', data, {
    singletonKey: data.draftVersionId,
    group: { id: data.workspaceId },
  });
}

export const draftingCitationsCheck = defineJob({
  name: 'drafting.citations.check',
  schema: draftingCitationsCheckSchema,
  singleton: { key: (payload) => payload.draftVersionId },
  idempotencyKey: (payload) => payload.draftVersionId,
  concurrency: 2,
  timeoutSec: 120,
  retry: { limit: DRAFTING_CITATIONS_RETRIES, delaySec: 30 },
  handler: async (ctx, payload) => {
    await runDraftingCitationsCheck(ctx, payload);
  },
});
