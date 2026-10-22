// The AI gateway: one typed entry point for every model call. "Input in, validated JSON out":
// there is no tool, function-calling, web or retrieval parameter. Order of operations:
//
//   idempotent reuse -> sensitive block -> residency -> injection flag -> estimate -> concurrency
//   -> reserve budget -> provider (retry, failover) -> schema validation (one repair) -> audit
//   -> commit budget -> store idempotent result
//
// Failures release the reservation and write an `ai_call` row with the failure status (never with
// input content). See ADR 0007 and ADR 0022.
import {
  AiGatewayError,
  BudgetExceededError,
  InvalidInputError,
  NoProviderError,
  OutputInvalidError,
  ProviderError,
  ResidencyViolationError,
  SensitiveMatterBlockedError,
} from './errors.ts';
import { inputHash } from './hash.ts';
import type { AuditRecord, BudgetReservation, GatewayPorts } from './ports.ts';
import { detectInjection } from './policy/injection.ts';
import { allowedChain } from './policy/residency.ts';
import { assertAiAllowed } from './policy/sensitive.ts';
import { costPaise, estimatePaise } from './pricing.ts';
import { getTask } from './tasks/registry.ts';
import type { GatewayResult, Provider, RunContext, TaskDef } from './types.ts';
import { validateWithRepair } from './validate.ts';

export interface GatewayConfig {
  providers: readonly Provider[];
  ports: GatewayPorts;
  /** Concurrent calls per workspace; default 4. */
  maxConcurrencyPerWorkspace?: number;
  now?: () => Date;
}

export interface AiGateway {
  run<O = unknown>(taskId: string, input: unknown, ctx: RunContext): Promise<GatewayResult<O>>;
}

const DEBUG_MAX_MS = 24 * 60 * 60 * 1000;

class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    const next = this.waiting.shift();
    if (next === undefined) this.active -= 1;
    else next();
  }
}

const isBudgetError = (error: unknown): boolean =>
  error instanceof BudgetExceededError ||
  (typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'BUDGET_EXCEEDED');

function statusFor(error: unknown): string {
  if (error instanceof SensitiveMatterBlockedError) return 'blocked_sensitive';
  if (error instanceof ResidencyViolationError) return 'residency_violation';
  if (isBudgetError(error)) return 'budget_exceeded';
  if (error instanceof OutputInvalidError) return 'output_invalid';
  return 'error';
}

export function createGateway(config: GatewayConfig): AiGateway {
  const { ports, providers } = config;
  const now = config.now ?? (() => new Date());
  const limit = Math.max(1, config.maxConcurrencyPerWorkspace ?? 4);
  const semaphores = new Map<string, Semaphore>();
  const semaphoreFor = (workspaceId: string): Semaphore => {
    let s = semaphores.get(workspaceId);
    if (s === undefined) {
      s = new Semaphore(limit);
      semaphores.set(workspaceId, s);
    }
    return s;
  };

  /** The providers for `task`: the task's chain, or the mock when no real provider is registered. */
  function chainFor(task: TaskDef): Provider[] {
    const mock = providers.find((p) => p.id === 'mock');
    const real = providers.filter((p) => p.id !== 'mock');
    if (real.length === 0 && mock !== undefined) return [mock];
    return task.providers
      .map((id) => real.find((p) => p.id === id))
      .filter((p): p is Provider => p !== undefined && p.supports.includes(task.id));
  }

  async function run<O>(
    taskId: string,
    rawInput: unknown,
    ctx: RunContext,
  ): Promise<GatewayResult<O>> {
    const started = performance.now();
    const task = getTask(taskId);
    const parsedInput = task.input.safeParse(rawInput);
    if (!parsedInput.success) {
      throw new InvalidInputError(
        task.id,
        parsedInput.error.issues.map((i) => i.path.join('.') || '(root)').join(', '),
      );
    }
    const input = parsedInput.data;
    const key = ctx.idempotencyKey === undefined ? null : `${ctx.idempotencyKey}:${task.id}`;

    if (key !== null && ports.idempotency !== undefined) {
      const stored = await ports.idempotency.get(ctx.workspaceId, key);
      if (stored !== null) return stored as GatewayResult<O>;
    }

    const base = {
      userId: ctx.userId ?? null,
      purpose: ctx.purpose,
      task: task.id,
      automationLevel: ctx.automationLevel ?? task.defaultLevel ?? 1,
      captureId: ctx.captureId ?? null,
      matterId: ctx.matterId ?? null,
    } as const;
    const failureRow = (error: unknown, extra: Partial<AuditRecord> = {}): AuditRecord => ({
      ...base,
      provider: 'none',
      model: 'none',
      region: 'none',
      inputTokens: 0,
      outputTokens: 0,
      costPaise: 0,
      latencyMs: Math.round(performance.now() - started),
      status: statusFor(error),
      errorCode: error instanceof AiGatewayError ? error.code : 'UNEXPECTED',
      inputSha256: null,
      suspicious: false,
      ...extra,
    });

    const policy = await ports.settings.getPolicy(ctx.workspaceId, {
      matterId: ctx.matterId,
      captureId: ctx.captureId,
    });
    try {
      assertAiAllowed(policy);
    } catch (error) {
      // Blocked before any provider is contacted; the row has no input hash or content.
      await ports.audit.record(ctx.workspaceId, failureRow(error));
      throw error;
    }

    const hash = inputHash(input);
    const suspicious = detectInjection(input);
    const withInput = { inputSha256: hash, suspicious };

    let chain: Provider[];
    try {
      chain = allowedChain(task, chainFor(task), policy.indiaOnly);
      if (chain.length === 0) throw new NoProviderError(task.id);
    } catch (error) {
      await ports.audit.record(ctx.workspaceId, failureRow(error, withInput));
      throw error;
    }
    const primary = chain[0] as Provider;
    const estimate = estimatePaise(primary.id, primary.modelFor(task), task, input);

    const semaphore = semaphoreFor(ctx.workspaceId);
    await semaphore.acquire();
    let reservation: BudgetReservation | null = null;
    try {
      try {
        reservation = await ports.budget.reserve(ctx.workspaceId, estimate, ctx.purpose);
      } catch (error) {
        if (isBudgetError(error)) {
          const typed = new BudgetExceededError();
          await ports.audit.record(ctx.workspaceId, failureRow(typed, withInput));
          throw typed;
        }
        throw error;
      }

      let result: { provider: Provider; validated: Awaited<ReturnType<typeof validateWithRepair>> };
      try {
        result = await callChain(task, input, chain, suspicious);
      } catch (error) {
        await ports.budget.release(ctx.workspaceId, reservation);
        reservation = null;
        await ports.audit
          .record(ctx.workspaceId, failureRow(error, withInput))
          .catch(() => undefined);
        throw error;
      }

      const { provider, validated } = result;
      const cost = costPaise(provider.id, validated.model, validated.usage);
      const output = validated.output as O;
      const confidence =
        typeof (validated.output as { confidence?: unknown } | null)?.confidence === 'number'
          ? (validated.output as { confidence: number }).confidence
          : null;
      let call: { id: string };
      try {
        call = await ports.audit.record(ctx.workspaceId, {
          ...base,
          provider: provider.id,
          model: validated.model,
          modelVersion: validated.modelVersion ?? null,
          region: provider.region,
          inputTokens: validated.usage.inputTokens,
          outputTokens: validated.usage.outputTokens,
          costPaise: cost,
          confidence,
          latencyMs: Math.round(performance.now() - started),
          status: 'ok',
          errorCode: null,
          idempotencyKey: key,
          ...withInput,
        });
      } catch (error) {
        await ports.budget.release(ctx.workspaceId, reservation);
        reservation = null;
        throw error;
      }
      await ports.budget.commit(ctx.workspaceId, reservation, cost, call.id);
      reservation = null;

      const gatewayResult: GatewayResult<O> = {
        output,
        callId: call.id,
        provider: provider.id,
        model: validated.model,
        region: provider.region,
        usage: { ...validated.usage, costPaise: cost },
      };
      const debugUntil = policy.debugUntil?.getTime();
      const debugActive =
        debugUntil !== undefined &&
        debugUntil > now().getTime() &&
        debugUntil - now().getTime() <= DEBUG_MAX_MS;
      if (debugActive && ports.debugSink !== undefined) {
        await ports.debugSink.store(ctx.workspaceId, call.id, { input, output });
      }
      if (key !== null && ports.idempotency !== undefined) {
        await ports.idempotency.put(ctx.workspaceId, key, gatewayResult);
      }
      return gatewayResult;
    } finally {
      semaphore.release();
    }
  }

  /** Try each provider in order; fail over only on retryable provider errors. */
  async function callChain(
    task: TaskDef,
    input: unknown,
    chain: readonly Provider[],
    suspicious: boolean,
  ): Promise<{ provider: Provider; validated: Awaited<ReturnType<typeof validateWithRepair>> }> {
    let last: unknown;
    for (const provider of chain) {
      try {
        const first = await provider.call(task, input, { suspicious });
        const validated = await validateWithRepair(task, first, (issues) =>
          provider.call(task, input, { suspicious, repair: { issues } }),
        );
        return { provider, validated };
      } catch (error) {
        last = error;
        if (!(error instanceof ProviderError && error.retryable)) throw error;
      }
    }
    throw last instanceof Error ? last : new NoProviderError(task.id);
  }

  return { run };
}
