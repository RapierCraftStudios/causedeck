// The grounded matter copilot (#1115, ADR 0051, D-004, ADR 0045 L-level: it proposes, nothing is sent
// or filed). `askCopilot` gathers sources the actor may read (matter facts, the matter's document
// pages, the anonymised corpus), asks the workspace-scope gateway with the matter id in the run
// context (so a sensitive matter never reaches a provider), verifies every claim against the stored
// text and returns verified claims, unsupported claims, the written answer citing only verified
// claims (#1167) and `noAuthority`. One `copilot.questions` unit
// per new question against the plan's cap (idempotent on `requestId`); audited as `copilot.asked`
// with hashes and source ids only. A failing model call throws: no answer is invented. A demo
// workspace calls no model: its answer is extractive (the best-matching sentences of the sources).
// Preview exception (#1165): when the preview-only `chatgpt-plan` provider is configured, a demo
// workspace (`is_demo` and a demo slug) asks it instead, through a gateway that carries only that
// provider; its claims are verified the same way (D-004). The plan's usage limit becomes
// RATE_LIMITED and an unavailable plan a client-safe CONFLICT; nothing is counted then. A real
// workspace never reaches the plan provider.
import { createHash, randomUUID } from 'node:crypto';

import {
  AiGatewayError,
  type AiGateway,
  type EmbedGateway,
  type Provider,
  type RerankGateway,
} from '@causedeck/ai';
import { isRole } from '@causedeck/auth';
import { currentScope, isUuid, withWorkspace, type Queryable } from '@causedeck/db';
import {
  answerMatterQuestion,
  createExtractiveMatterAnswerResolver,
  createGatewayMatterAnswerResolver,
  type CopilotSource,
  type MatterAnswer,
  type MatterAnswerResolver,
} from '@causedeck/intelligence';

import {
  createCoreAiGateway,
  isPreviewPlanWorkspace,
  previewPlanProviderFromEnv,
} from '../ai/index.ts';
import { record } from '../audit/index.ts';
import { getWorkspaceEntitlements } from '../billing/index.ts';
import type { GraphEvents } from '../matter-graph/index.ts';
import { isDemoWorkspace } from '../shared/demo-guard.ts';
import { conflict, forbidden, invalid, rateLimited } from '../shared/errors.ts';
import { getUsage, increment, usagePeriod, type UsageContext } from '../usage/index.ts';
import { memberRole } from '../workspaces/index.ts';

import { corpusSources, documentSources, factSources, type JudgmentRef } from './sources.ts';

export const COPILOT_QUESTION_KEY = 'copilot.questions' as const;

/** Monthly questions by plan id; a plan with no entry is unlimited. */
export const COPILOT_QUESTION_CAPS: Readonly<Record<string, number>> = Object.freeze({
  junior: 30,
});

export const COPILOT_QUESTION_MAX_CHARS = 4000;

export interface CopilotActor {
  workspaceId: string;
  userId: string;
}

export interface CopilotInput {
  question: string;
  /** Omitted for the workspace-level copilot: no matter facts or documents. */
  matterId?: string;
  /** Makes a retried request count once. */
  requestId?: string;
}

export interface CopilotDeps {
  /** The workspace-scope gateway the answer model runs on. */
  gateway?: AiGateway;
  /** Replaces the answer model (tests). */
  answer?: MatterAnswerResolver;
  embed?: EmbedGateway;
  rerank?: RerankGateway;
  events?: GraphEvents;
  now?: () => Date;
  /**
   * The preview-only `chatgpt-plan` provider (#1165); defaults to `previewPlanProviderFromEnv()`,
   * read only for a demo workspace. Null: demo workspaces answer extractively.
   */
  previewPlanProvider?: Provider | null;
}

/** Shown when the preview plan's usage limit is reached (#1165). */
export const PLAN_LIMIT_MESSAGE = 'The preview AI plan limit is reached. Try again later.';
/** Shown when the preview plan cannot answer right now (#1165). */
export const PLAN_UNAVAILABLE_MESSAGE = 'The preview AI is unavailable right now. Try again later.';

/** Client-safe errors for the preview plan's limit and availability; anything else is rethrown. */
function planError(error: unknown): unknown {
  if (error instanceof AiGatewayError) {
    if (error.code === 'PLAN_LIMIT_REACHED') return rateLimited(PLAN_LIMIT_MESSAGE);
    if (error.code === 'PLAN_UNAVAILABLE') return conflict(PLAN_UNAVAILABLE_MESSAGE);
  }
  return error;
}

export interface CopilotUsage {
  used: number;
  /** The month's cap on the plan; null when unlimited. */
  limit: number | null;
}

export interface CopilotAnswer extends MatterAnswer {
  /** The corpus judgments the claims may link to, from the stored record (never the model). */
  judgments: Record<string, JudgmentRef>;
  /** The matter is sensitive: AI is off for it, no source was read by a provider and nothing was counted. */
  aiBlocked: boolean;
  usage: CopilotUsage;
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const NOOP_EVENTS: GraphEvents = { emit: () => undefined };

async function asMember<T>(db: Queryable, actor: CopilotActor, fn: () => Promise<T>): Promise<T> {
  const { workspaceId, userId } = actor;
  const denied = () => forbidden('You cannot ask the copilot here');
  if (!isUuid(workspaceId) || !isUuid(userId)) throw denied();
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw denied();
  }
  const role = await withWorkspace(db, { workspaceId, userId }, (tx) =>
    memberRole(tx, userId, workspaceId),
  );
  if (role === null || !isRole(role)) throw denied();
  return fn();
}

async function usageOf(ctx: UsageContext): Promise<CopilotUsage> {
  const now = ctx.now?.() ?? new Date();
  const [used, entitlements] = await Promise.all([
    getUsage(ctx, COPILOT_QUESTION_KEY, usagePeriod(now)),
    withWorkspace(ctx.db, { workspaceId: ctx.workspaceId }, (tx) =>
      getWorkspaceEntitlements(tx, ctx.workspaceId, now),
    ),
  ]);
  return { used, limit: COPILOT_QUESTION_CAPS[entitlements.planId] ?? null };
}

export async function askCopilot(
  db: Queryable,
  actor: CopilotActor,
  input: CopilotInput,
  deps: CopilotDeps = {},
): Promise<CopilotAnswer> {
  const question = input.question.trim();
  if (question === '' || question.length > COPILOT_QUESTION_MAX_CHARS) {
    throw invalid(`Ask in 1 to ${String(COPILOT_QUESTION_MAX_CHARS)} characters`);
  }
  if (input.matterId !== undefined && !isUuid(input.matterId)) throw invalid('Matter not found');
  return asMember(db, actor, async () => {
    const ctx: UsageContext = {
      db,
      workspaceId: actor.workspaceId,
      ...(deps.now === undefined ? {} : { now: deps.now }),
    };
    const before = await usageOf(ctx);
    if (before.limit !== null && before.used >= before.limit) {
      throw rateLimited(
        `You have reached this month's limit of ${String(before.limit)} copilot questions on your plan.`,
      );
    }
    const requestId = input.requestId ?? randomUUID();
    const graph = { db, events: deps.events ?? NOOP_EVENTS };

    const sources: CopilotSource[] = [];
    if (input.matterId !== undefined) {
      // Obligations are read as the actor on the request's clock (overdue is relative to today).
      const { facts, sensitive } = await factSources(graph, actor, input.matterId, {
        ...graph,
        ...(deps.now === undefined ? {} : { now: deps.now }),
      });
      if (sensitive) {
        return {
          claims: [],
          unsupported: [],
          answerText: '',
          answer: '',
          noAuthority: false,
          judgments: {},
          aiBlocked: true,
          usage: before,
        };
      }
      sources.push(...facts);
      sources.push(...(await documentSources(db, graph, actor, input.matterId, question)));
    }
    const corpus = await corpusSources(db, question, {
      ...(deps.embed === undefined ? {} : { embed: deps.embed }),
      ...(deps.rerank === undefined ? {} : { rerank: deps.rerank }),
    });
    sources.push(...corpus.sources);

    // A demo workspace makes no AI call and spends nothing (#93, the gateway refuses it): it answers
    // extractively from the same sources, verified the same way, so the demo journey still works.
    // With the preview plan provider configured (#1165), a preview-plan demo workspace asks it.
    const demo = await withWorkspace(db, { workspaceId: actor.workspaceId }, (tx) =>
      isDemoWorkspace(tx, actor.workspaceId),
    );
    const plan =
      demo && deps.answer === undefined
        ? deps.previewPlanProvider === undefined
          ? previewPlanProviderFromEnv()
          : deps.previewPlanProvider
        : null;
    const viaPlan = plan !== null && (await isPreviewPlanWorkspace(db, actor.workspaceId));
    const now = deps.now === undefined ? {} : { now: deps.now };
    const resolve =
      deps.answer ??
      (demo && !viaPlan ? createExtractiveMatterAnswerResolver() : undefined) ??
      createGatewayMatterAnswerResolver({
        gateway:
          deps.gateway ?? createCoreAiGateway(db, viaPlan ? { ...now, providers: [plan] } : now),
        scope: {
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          ...(input.matterId === undefined ? {} : { matterId: input.matterId }),
          // A retry of the same request reuses the stored model result instead of calling again.
          idempotencyKey: `copilot:${requestId}`,
        },
      });
    const answer = await answerMatterQuestion(question, sources, resolve).catch(
      (error: unknown) => {
        throw planError(error);
      },
    );

    await increment(ctx, COPILOT_QUESTION_KEY, 1, {
      idempotencyKey: `copilot-question:${requestId}`,
    });
    await withWorkspace(db, { workspaceId: actor.workspaceId, userId: actor.userId }, (tx) =>
      record(
        {
          db: tx,
          workspaceId: actor.workspaceId,
          actor: { userId: actor.userId, kind: 'user' },
          requestId,
        },
        {
          action: 'copilot.asked',
          target: { kind: 'copilot_question', id: requestId },
          metadata: {
            question_sha256: sha256(question),
            answer_sha256: sha256(answer.answerText),
            matter_id: input.matterId ?? null,
            source_ids: sources.map((s) => s.id).join(','),
            claims: answer.claims.length,
            unsupported: answer.unsupported.length,
          },
        },
      ),
    );
    return {
      ...answer,
      judgments: corpus.judgments,
      aiBlocked: false,
      usage: { used: before.used + 1, limit: before.limit },
    };
  });
}
