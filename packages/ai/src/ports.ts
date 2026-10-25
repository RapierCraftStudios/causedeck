// Ports the gateway needs from the outside. `packages/ai` imports no domain package: budgets,
// settings, audit and idempotent results are implemented in `packages/core/src/ai/wiring.ts`.
import type { GatewayResult } from './types.ts';

export type AutomationLevel = 1 | 2 | 3 | 4;

export interface BudgetReservation {
  readonly id: string;
}

export interface BudgetPort {
  /** Hold `estimatedPaise`; throws an error with `code: 'BUDGET_EXCEEDED'` when over budget. */
  reserve(workspaceId: string, estimatedPaise: number, purpose: string): Promise<BudgetReservation>;
  /** Replace the reservation with the actual spend, tagged with the `ai_call` id. */
  commit(
    workspaceId: string,
    reservation: BudgetReservation,
    actualPaise: number,
    aiCallId: string,
  ): Promise<void>;
  release(workspaceId: string, reservation: BudgetReservation): Promise<void>;
}

export interface AiPolicyContext {
  /** `workspace_settings.india_only_ai` (default true). */
  indiaOnly: boolean;
  matterSensitive: boolean;
  captureAiBlocked: boolean;
  /**
   * When the workspace's raw-payload debug flag lapses, or null when it is off. The gateway honours
   * it for at most 24 hours from now, whatever the stored value says.
   */
  debugUntil?: Date | null;
}

export interface SettingsPort {
  getPolicy(
    workspaceId: string,
    scope: { matterId?: string | undefined; captureId?: string | undefined },
  ): Promise<AiPolicyContext>;
}

export interface AuditRecord {
  userId?: string | null;
  purpose: string;
  task: string;
  provider: string;
  model: string;
  modelVersion?: string | null;
  region: string;
  inputTokens: number;
  outputTokens: number;
  costPaise: number;
  confidence?: number | null;
  automationLevel: AutomationLevel;
  latencyMs: number;
  /** `ok`, `error`, `blocked_sensitive`, `residency_violation`, `budget_exceeded`, `output_invalid`. */
  status: string;
  errorCode?: string | null;
  /** sha256 hex of the normalised input; null on blocked calls. */
  inputSha256: string | null;
  captureId?: string | null;
  matterId?: string | null;
  suspicious: boolean;
  /** Set on `ok` rows only. */
  idempotencyKey?: string | null;
}

export interface AuditPort {
  record(workspaceId: string, record: AuditRecord): Promise<{ id: string }>;
}

/** Stores the validated result of a call so a job retry reuses it instead of paying twice. */
export interface IdempotencyPort {
  get(workspaceId: string, key: string): Promise<GatewayResult | null>;
  put(workspaceId: string, key: string, result: GatewayResult): Promise<void>;
}

/** Receives raw input and output only while a workspace's debug flag is active. */
export interface DebugSink {
  store(
    workspaceId: string,
    callId: string,
    payload: { input: unknown; output: unknown },
  ): Promise<void>;
}

export interface GatewayPorts {
  budget: BudgetPort;
  settings: SettingsPort;
  audit: AuditPort;
  idempotency?: IdempotencyPort;
  debugSink?: DebugSink;
}
