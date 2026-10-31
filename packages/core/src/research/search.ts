// Fact-pattern search over the judgment corpus (#896, ADR 0051 §Query pipeline). The pipeline lives in
// `@causedeck/intelligence` (plan, lexical and vector retrieval, fusion, rerank, group, verified
// answer); this service puts a workspace around it:
//
// - Membership: only an active member of the workspace searches. The corpus is global and public, so
//   no tenant row is read or written except the usage counter and the audit event of the caller.
// - Metering and plan limits: each new search is one `research.searches` unit in the IST month. Junior
//   is capped (`RESEARCH_SEARCH_CAPS`), paid plans are not. Re-running with an edited plan (a filter
//   chip changed) is audited but not metered: it never plans again and is the advocate refining one
//   search, not starting another. Embedding and rerank spend is platform spend.
// - The planner and answer models run at platform scope (no workspace), the same as the corpus
//   enrichment jobs, on the mock provider unless a real one is configured.
// - Audit: one `research.searched` event per search with the hash of the query, the hash of the plan
//   and the ids of the retrieval set; the query text and the passages are never written to it. The plan
//   call itself leaves its `corpus_ocr_call` row.
// - Redaction (D-053): results carry `judgment_segment.text` only; titles are the stored masked form.
import { createHash, randomUUID } from 'node:crypto';

import {
  createEmbedGateway,
  createMockEmbedProvider,
  createMockRerankProvider,
  createRerankGateway,
  type AiGateway,
  type EmbedGateway,
  type RerankGateway,
} from '@causedeck/ai';
import { isRole } from '@causedeck/auth';
import { currentScope, isUuid, withWorkspace, type Queryable } from '@causedeck/db';
import {
  createGatewayAnswerResolver,
  createGatewayPlanResolver,
  drizzleRetriever,
  searchCorpus,
  searchCorpusWithPlan,
  statuteChips,
  SUBJECT_AREAS,
  validatePlan,
  type AnswerResolver,
  type PlanResolver,
  type ResearchPlan,
  type SearchResult,
  type StatuteChip,
} from '@causedeck/intelligence';

import { createPlatformAiGateway, PLATFORM_AI_SCOPE } from '../ai/index.ts';
import { record } from '../audit/index.ts';
import { getWorkspaceEntitlements } from '../billing/index.ts';
import { forbidden, invalid, rateLimited } from '../shared/errors.ts';
import { getUsage, increment, usagePeriod, type UsageContext } from '../usage/index.ts';
import { memberRole } from '../workspaces/index.ts';

export const RESEARCH_SEARCH_KEY = 'research.searches' as const;

/** Monthly searches by plan id; a plan with no entry is unlimited. */
export const RESEARCH_SEARCH_CAPS: Readonly<Record<string, number>> = Object.freeze({
  junior: 30,
});

export const RESEARCH_QUERY_MAX_CHARS = 4000;

/** The subject areas a filter chip may name (the corpus vocabulary of #894), for the page's selector. */
export const RESEARCH_SUBJECT_AREAS: readonly string[] = SUBJECT_AREAS;

export interface ResearchSearchActor {
  workspaceId: string;
  userId: string;
}

export interface ResearchSearchDeps {
  embed?: EmbedGateway;
  rerank?: RerankGateway;
  /** The platform-scope gateway the planner and answer models run on. */
  gateway?: AiGateway;
  /** Replaces the planner or the answer model (tests). */
  plan?: PlanResolver;
  answer?: AnswerResolver;
  now?: () => Date;
}

export interface ResearchSearchInput {
  query: string;
  /** Also produce a verified answer. */
  answer?: boolean;
  /** Makes a retried request count once. */
  requestId?: string;
}

export interface ResearchRerunInput {
  /** The plan as edited in the filter chips; validated strictly. */
  plan: unknown;
  answer?: boolean;
  requestId?: string;
}

export interface ResearchUsage {
  used: number;
  /** The month's cap on the plan; null when unlimited. */
  limit: number | null;
}

export interface AuthoritySearchResult extends SearchResult {
  usage: ResearchUsage;
  /** The plan's statutes with their IPC/BNS, CrPC/BNSS and IEA/BSA counterparts, for the filter chips. */
  chips: StatuteChip[];
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The deterministic mock embedder and reranker, like `system.corpus.embed` until a real model is configured. */
function wire(db: Queryable, deps: ResearchSearchDeps) {
  const embed = deps.embed ?? createEmbedGateway({ providers: [createMockEmbedProvider()] });
  const rerank = deps.rerank ?? createRerankGateway({ providers: [createMockRerankProvider()] });
  const gateway = deps.gateway ?? createPlatformAiGateway(db);
  const scope = { workspaceId: PLATFORM_AI_SCOPE };
  return {
    retriever: drizzleRetriever(db, { embeddingModel: embed.active().modelVersion }),
    embed,
    rerank,
    plan: deps.plan ?? createGatewayPlanResolver({ gateway, scope }),
    answer: deps.answer ?? createGatewayAnswerResolver({ gateway, scope }),
  };
}

async function asMember<T>(
  db: Queryable,
  actor: ResearchSearchActor,
  fn: () => Promise<T>,
): Promise<T> {
  const { workspaceId, userId } = actor;
  if (!isUuid(workspaceId) || !isUuid(userId))
    throw forbidden('You cannot search authorities here');
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw forbidden('You cannot search authorities here');
  }
  const role = await withWorkspace(db, { workspaceId, userId }, (tx) =>
    memberRole(tx, userId, workspaceId),
  );
  if (role === null || !isRole(role)) throw forbidden('You cannot search authorities here');
  return fn();
}

async function usageOf(ctx: UsageContext): Promise<ResearchUsage> {
  const now = ctx.now?.() ?? new Date();
  const [used, entitlements] = await Promise.all([
    getUsage(ctx, RESEARCH_SEARCH_KEY, usagePeriod(now)),
    withWorkspace(ctx.db, { workspaceId: ctx.workspaceId }, (tx) =>
      getWorkspaceEntitlements(tx, ctx.workspaceId, now),
    ),
  ]);
  return { used, limit: RESEARCH_SEARCH_CAPS[entitlements.planId] ?? null };
}

const compact = (ids: readonly string[]): string => ids.join(',');

async function audit(
  db: Queryable,
  actor: ResearchSearchActor,
  result: SearchResult,
  extra: { mode: 'search' | 'rerun'; requestId: string },
): Promise<void> {
  const segmentIds = result.hits.flatMap((h) => h.segments.map((s) => s.segmentId));
  await withWorkspace(db, { workspaceId: actor.workspaceId, userId: actor.userId }, (tx) =>
    record(
      {
        db: tx,
        workspaceId: actor.workspaceId,
        actor: { userId: actor.userId, kind: 'user' },
        requestId: extra.requestId,
      },
      {
        action: 'research.searched',
        target: { kind: 'research_search', id: extra.requestId },
        metadata: {
          mode: extra.mode,
          query_sha256: sha256(result.plan.query),
          plan_sha256: sha256(JSON.stringify(result.plan)),
          planner: result.plan.planner,
          judgment_ids: compact(result.hits.map((h) => h.judgmentId)),
          segment_ids: compact(segmentIds),
          lexical: result.counts.lexical,
          vector: result.counts.vector,
          reranked: result.counts.reranked,
          answered: result.answer !== null,
          cost_paise: result.costPaise,
        },
      },
    ),
  );
}

/**
 * Plans `input.query` and searches the corpus. Counts one search against the workspace's month;
 * past the plan's cap it throws RATE_LIMITED with a client-safe message and spends nothing.
 */
export async function searchAuthorities(
  db: Queryable,
  actor: ResearchSearchActor,
  input: ResearchSearchInput,
  deps: ResearchSearchDeps = {},
): Promise<AuthoritySearchResult> {
  const query = input.query.trim();
  if (query === '' || query.length > RESEARCH_QUERY_MAX_CHARS) {
    throw invalid(`Describe the facts in 1 to ${String(RESEARCH_QUERY_MAX_CHARS)} characters`);
  }
  return asMember(db, actor, async () => {
    const ctx: UsageContext = {
      db,
      workspaceId: actor.workspaceId,
      ...(deps.now === undefined ? {} : { now: deps.now }),
    };
    const before = await usageOf(ctx);
    if (before.limit !== null && before.used >= before.limit) {
      throw rateLimited(
        `You have reached this month's limit of ${String(before.limit)} authority searches on your plan.`,
      );
    }
    const requestId = input.requestId ?? randomUUID();
    const result = await searchCorpus(wire(db, deps), query, { answer: input.answer === true });
    await increment(ctx, RESEARCH_SEARCH_KEY, 1, {
      idempotencyKey: `research-search:${requestId}`,
    });
    await audit(db, actor, result, { mode: 'search', requestId });
    return {
      ...result,
      usage: { used: before.used + 1, limit: before.limit },
      chips: statuteChips(result.plan),
    };
  });
}

/**
 * Searches again with a plan edited in the filter chips. It never calls the planner, validates the
 * plan strictly (a plan outside the vocabularies is VALIDATION), and is audited but not metered.
 */
export async function rerunAuthoritySearch(
  db: Queryable,
  actor: ResearchSearchActor,
  input: ResearchRerunInput,
  deps: ResearchSearchDeps = {},
): Promise<AuthoritySearchResult> {
  const plan: ResearchPlan | null = validatePlan(input.plan);
  if (plan === null) throw invalid('The filters are not valid');
  return asMember(db, actor, async () => {
    const ctx: UsageContext = {
      db,
      workspaceId: actor.workspaceId,
      ...(deps.now === undefined ? {} : { now: deps.now }),
    };
    const requestId = input.requestId ?? randomUUID();
    // A re-run cannot start a search the cap would have refused.
    const before = await usageOf(ctx);
    if (before.limit !== null && before.used >= before.limit) {
      throw rateLimited(
        `You have reached this month's limit of ${String(before.limit)} authority searches on your plan.`,
      );
    }
    const result = await searchCorpusWithPlan(wire(db, deps), plan, {
      answer: input.answer === true,
    });
    await audit(db, actor, result, { mode: 'rerun', requestId });
    return { ...result, usage: before, chips: statuteChips(result.plan) };
  });
}
