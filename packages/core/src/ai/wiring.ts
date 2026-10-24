// Core's side of the AI gateway (#44): the ports `@causedeck/ai` declares, implemented on the
// usage service (budgets, #30), `workspace_settings.india_only_ai` and `matter.sensitive`, the
// `ai_call` writer (#227) and the 24 h `ai_call_result` store for idempotent job retries. The AI
// package imports no domain package; everything it needs arrives through these ports.
import {
  createGateway,
  createMockProvider,
  type AiGateway,
  type AiPolicyContext,
  type GatewayPorts,
  type GatewayResult,
  type Provider,
} from '@causedeck/ai';
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import { and, eq, gt, lte, sql } from 'drizzle-orm';

import { recordAiCall } from '../audit/index.ts';
import { commit, release, reserve, type Reservation, type UsageContext } from '../usage/index.ts';

const { aiCall, aiCallResult, matter, workspaceSettings } = schema;

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

  return {
    budget: {
      async reserve(workspaceId, estimatedPaise, purpose) {
        const reservation = await reserve(usageCtx(workspaceId), {
          estimatePaise: estimatedPaise,
          purpose,
        });
        const handle = { id: reservation.id };
        held.set(handle, reservation);
        return handle;
      },
      async commit(workspaceId, handle, actualPaise, aiCallId) {
        const reservation = held.get(handle);
        if (reservation === undefined) throw new Error('ai budget: unknown reservation');
        await commit(usageCtx(workspaceId), reservation, actualPaise, { aiCallId });
      },
      async release(workspaceId, handle) {
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
  return createGateway({
    providers,
    ports: createAiPorts(db, options),
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
