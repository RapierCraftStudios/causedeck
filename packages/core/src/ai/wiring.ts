// Core's side of the AI gateway (#44): the ports `@causedeck/ai` declares, implemented on the
// usage service (budgets, #30), `workspace_settings.india_only_ai` and `matter.sensitive`, the
// `ai_call` writer (#227) and the 24 h `ai_call_result` store for idempotent job retries. The AI
// package imports no domain package; everything it needs arrives through these ports.
import { serverEnv, type ServerEnv } from '@causedeck/config/env';
import {
  createBgem3Provider,
  createChatgptPlanProvider,
  createChatgptPlanTokenStore,
  createGateway,
  createMockEmbedProvider,
  createMockProvider,
  PREVIEW_PLAN_PROVIDER_ID,
  SELF_HOSTED_REGION,
  type AiGateway,
  type AiPolicyContext,
  type EmbedProvider,
  type GatewayPorts,
  type GatewayResult,
  type Provider,
} from '@causedeck/ai';
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import { isDemoWorkspaceSlug } from '@causedeck/validators';
import { and, eq, gt, lte, sql } from 'drizzle-orm';

import { recordAiCall } from '../audit/index.ts';
import { assertNotDemoWorkspace } from '../shared/demo-guard.ts';
import { commit, release, reserve, type Reservation, type UsageContext } from '../usage/index.ts';

const { aiCall, aiCallResult, matter, organization, workspaceSettings } = schema;

/** How long a stored idempotent result is reused. */
export const AI_RESULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface AiPortsOptions {
  now?: () => Date;
  /** Passed to the usage service (courtesy grace, soft-limit notice delivery). */
  usage?: Pick<UsageContext, 'thresholds' | 'enqueueDelivery'>;
  /**
   * Whether a capture is marked `ai_blocked`. The capture table arrives with the capture inbox, so
   * until a caller supplies this, no capture is blocked. A sensitive matter is always blocked.
   */
  isCaptureAiBlocked?: (workspaceId: string, captureId: string) => Promise<boolean>;
  /**
   * The gateway carries the preview-only `chatgpt-plan` provider (#1165). Then a preview-plan
   * workspace (see `isPreviewPlanWorkspace`) gets `previewPlanProvider` in its policy and a no-op
   * budget reservation (plan usage is billed to the ChatGPT subscription, never to the workspace).
   */
  previewPlan?: boolean;
}

/**
 * True when `workspaceId` may use the preview plan provider: a demo workspace (`is_demo`) whose slug
 * is a demo slug (`demo`, `demo-…`). Read under the workspace's RLS scope.
 */
export async function isPreviewPlanWorkspace(db: Queryable, workspaceId: string): Promise<boolean> {
  const [row] = await withWorkspace(db, { workspaceId }, (tx) =>
    tx
      .select({ isDemo: organization.isDemo, slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, workspaceId)),
  );
  return row?.isDemo === true && isDemoWorkspaceSlug(row.slug);
}

let previewPlanMemo: { env: ServerEnv; provider: Provider | null } | undefined;

/**
 * The preview-only `chatgpt-plan` provider (#1165), built only when `AI_PROVIDER=chatgpt-plan` and
 * `ALLOW_PREVIEW_PLAN_PROVIDER=true`; otherwise null. Memoised per process (per env object). It is
 * never registered on the default gateways: callers use it for demo-workspace answers only.
 */
export function previewPlanProviderFromEnv(env: ServerEnv = serverEnv()): Provider | null {
  if (previewPlanMemo?.env === env) return previewPlanMemo.provider;
  const provider =
    env.AI_PROVIDER === 'chatgpt-plan' && env.ALLOW_PREVIEW_PLAN_PROVIDER
      ? createChatgptPlanProvider({
          model: env.CHATGPT_PLAN_MODEL,
          tokens: createChatgptPlanTokenStore({
            file: env.CHATGPT_PLAN_TOKEN_FILE,
            ...(env.CHATGPT_PLAN_CLIENT_ID === undefined
              ? {}
              : { clientId: env.CHATGPT_PLAN_CLIENT_ID }),
          }),
        })
      : null;
  previewPlanMemo = { env, provider };
  return provider;
}

let embedMemo: { env: ServerEnv; provider: EmbedProvider } | undefined;

/**
 * The corpus embed provider (#1198) for the embed job, research search and the copilot: the
 * self-hosted bge-m3 server when `EMBED_PROVIDER=bge-m3` and `BGE_M3_URL` are set, else the mock.
 * The server reports region `SELF_HOSTED_REGION` and passes the embed gateway's India-only check
 * only with `ALLOW_PREVIEW_SELF_HOSTED_EMBED=true` (config refuses that flag in production).
 * Memoised per process (per env object).
 */
export function embedProviderFromEnv(env: ServerEnv = serverEnv()): EmbedProvider {
  if (embedMemo?.env === env) return embedMemo.provider;
  const provider =
    env.EMBED_PROVIDER === 'bge-m3' && env.BGE_M3_URL !== undefined
      ? createBgem3Provider({
          baseUrl: env.BGE_M3_URL,
          region: SELF_HOSTED_REGION,
          ...(env.BGE_M3_TOKEN === undefined ? {} : { token: env.BGE_M3_TOKEN.reveal() }),
          previewSelfHosted: env.ALLOW_PREVIEW_SELF_HOSTED_EMBED,
        })
      : createMockEmbedProvider();
  embedMemo = { env, provider };
  return provider;
}

/** Segments per embedding request in the corpus embed job (`EMBED_BATCH_SIZE`, default 32). */
export function embedBatchSizeFromEnv(env: ServerEnv = serverEnv()): number {
  return env.EMBED_BATCH_SIZE;
}

/** The gateway ports for `db`, each call scoped to the workspace it is given. */
export function createAiPorts(db: Queryable, options: AiPortsOptions = {}): GatewayPorts {
  const now = options.now ?? (() => new Date());
  const usageCtx = (workspaceId: string): UsageContext => ({
    db,
    workspaceId,
    now,
    ...options.usage,
  });
  const held = new WeakMap<object, Reservation>();
  // Preview-plan calls reserve nothing (#1165): the handles commit and release as no-ops.
  const noop = new WeakSet<object>();
  const previewPlan = (workspaceId: string): Promise<boolean> =>
    options.previewPlan === true ? isPreviewPlanWorkspace(db, workspaceId) : Promise.resolve(false);

  return {
    budget: {
      async reserve(workspaceId, estimatedPaise, purpose) {
        if (await previewPlan(workspaceId)) {
          const handle = { id: 'preview-plan' };
          noop.add(handle);
          return handle;
        }
        // A demo workspace spends nothing on AI (#93): its content is static fixtures.
        await withWorkspace(db, { workspaceId }, (tx) => assertNotDemoWorkspace(tx, workspaceId));
        const reservation = await reserve(usageCtx(workspaceId), {
          estimatePaise: estimatedPaise,
          purpose,
        });
        const handle = { id: reservation.id };
        held.set(handle, reservation);
        return handle;
      },
      async commit(workspaceId, handle, actualPaise, aiCallId) {
        if (noop.has(handle)) return;
        const reservation = held.get(handle);
        if (reservation === undefined) throw new Error('ai budget: unknown reservation');
        await commit(usageCtx(workspaceId), reservation, actualPaise, { aiCallId });
      },
      async release(workspaceId, handle) {
        if (noop.has(handle)) return;
        const reservation = held.get(handle);
        if (reservation !== undefined) await release(usageCtx(workspaceId), reservation);
      },
    },
    settings: {
      async getPolicy(workspaceId, scope): Promise<AiPolicyContext> {
        const { indiaOnly, sensitive } = await withWorkspace(db, { workspaceId }, async (tx) => {
          const [settings] = await tx
            .select({ indiaOnlyAi: workspaceSettings.indiaOnlyAi })
            .from(workspaceSettings)
            .where(eq(workspaceSettings.workspaceId, workspaceId));
          const [row] =
            scope.matterId === undefined
              ? []
              : await tx
                  .select({ sensitive: matter.sensitive })
                  .from(matter)
                  .where(and(eq(matter.workspaceId, workspaceId), eq(matter.id, scope.matterId)));
          return { indiaOnly: settings?.indiaOnlyAi ?? true, sensitive: row?.sensitive ?? false };
        });
        const blocked =
          scope.captureId === undefined || options.isCaptureAiBlocked === undefined
            ? false
            : await options.isCaptureAiBlocked(workspaceId, scope.captureId);
        return {
          indiaOnly,
          matterSensitive: sensitive,
          captureAiBlocked: blocked,
          debugUntil: null,
          previewPlanProvider: await previewPlan(workspaceId),
        };
      },
    },
    audit: {
      record: (workspaceId, record) =>
        recordAiCall(db, workspaceId, {
          userId: record.userId ?? null,
          purpose: record.purpose,
          provider: record.provider,
          model: record.model,
          modelVersion: record.modelVersion ?? null,
          region: record.region,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          costPaise: record.costPaise,
          confidence: record.confidence ?? null,
          automationLevel: record.automationLevel,
          task: record.task,
          latencyMs: record.latencyMs,
          status: record.status,
          errorCode: record.errorCode ?? null,
          inputSha256: record.inputSha256,
          captureId: record.captureId ?? null,
          matterId: record.matterId ?? null,
          suspicious: record.suspicious,
          idempotencyKey: record.idempotencyKey ?? null,
        }),
    },
    idempotency: {
      get: (workspaceId, key) =>
        withWorkspace(db, { workspaceId }, async (tx) => {
          const [row] = await tx
            .select({ output: aiCallResult.output })
            .from(aiCallResult)
            .where(
              and(
                eq(aiCallResult.workspaceId, workspaceId),
                eq(aiCallResult.idempotencyKey, key),
                gt(aiCallResult.expiresAt, now()),
              ),
            );
          return row === undefined ? null : (row.output as GatewayResult);
        }),
      put: (workspaceId, key, result) =>
        withWorkspace(db, { workspaceId }, async (tx) => {
          // Expired results are never read; drop them as part of the next write.
          await tx
            .delete(aiCallResult)
            .where(
              and(eq(aiCallResult.workspaceId, workspaceId), lte(aiCallResult.expiresAt, now())),
            );
          await tx
            .insert(aiCallResult)
            .values({
              workspaceId,
              idempotencyKey: key,
              aiCallId: result.callId,
              output: result,
              expiresAt: new Date(now().getTime() + AI_RESULT_TTL_MS),
            })
            .onConflictDoNothing();
        }),
    },
  };
}

export interface CoreGatewayOptions extends AiPortsOptions {
  /** Real providers; with none, the deterministic mock serves every task (dev and CI). */
  providers?: readonly Provider[];
  maxConcurrencyPerWorkspace?: number;
}

/** A gateway wired to core's ports. Defaults to the mock provider: no credentials needed. */
export function createCoreAiGateway(db: Queryable, options: CoreGatewayOptions = {}): AiGateway {
  const providers = options.providers?.length ? options.providers : [createMockProvider()];
  const previewPlan =
    options.previewPlan ?? providers.some((p) => p.id === PREVIEW_PLAN_PROVIDER_ID);
  return createGateway({
    providers,
    ports: createAiPorts(db, { ...options, previewPlan }),
    ...(options.maxConcurrencyPerWorkspace === undefined
      ? {}
      : { maxConcurrencyPerWorkspace: options.maxConcurrencyPerWorkspace }),
    now: options.now ?? (() => new Date()),
  });
}

/** Total paise charged to a capture's `ok` calls: the per-capture cost view. */
export async function getCaptureCostPaise(
  db: Queryable,
  workspaceId: string,
  captureId: string,
): Promise<number> {
  const [row] = await withWorkspace(db, { workspaceId }, (tx) =>
    tx
      .select({ total: sql<string>`coalesce(sum(${aiCall.costPaise}), 0)` })
      .from(aiCall)
      .where(
        and(
          eq(aiCall.workspaceId, workspaceId),
          eq(aiCall.captureId, captureId),
          eq(aiCall.status, 'ok'),
        ),
      ),
  );
  return Number(row?.total ?? 0);
}
