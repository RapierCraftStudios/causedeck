// The `ai_call` writer contract for the AI gateway (#227 for #44; PRD TR-3). One row per model
// call, inserted inside the gateway's workspace transaction. `sources` carries identifiers and
// anchors only, never quoted content, and `automationLevel` is 1-4: there is no L5, and the
// `ai_call_automation_level_chk` CHECK rejects one even if this guard is bypassed. The table is
// append-only: record the user's later action as a new row, not an update.
import { schema, withWorkspace, type Queryable } from '@causedeck/db';

export type AutomationLevel = 1 | 2 | 3 | 4;

/** A source the model used: an id and an optional anchor within it (page, paragraph, span). */
export interface AiCallSource {
  id: string;
  anchor?: string;
}

export interface AiCallInput {
  userId?: string | null;
  /** What the call was for, e.g. `brief.draft`. */
  purpose: string;
  provider: string;
  model: string;
  modelVersion?: string | null;
  /** Data residency region the call ran in, e.g. `ap-south-1`. */
  region: string;
  inputTokens: number;
  outputTokens: number;
  costPaise: number;
  sources?: readonly AiCallSource[];
  /** 0-1, three decimal places. */
  confidence?: number | null;
  automationLevel: AutomationLevel;
  autoApplied?: boolean;
  userAction?: string | null;
  // Gateway columns (#44). All optional so earlier callers keep working.
  /** The gateway task id, e.g. `classify_document`. */
  task?: string | null;
  latencyMs?: number | null;
  /** `ok` by default; the gateway also records `blocked_sensitive`, `error` and similar. */
  status?: string;
  errorCode?: string | null;
  /** sha256 hex of the normalised input. The input itself is never stored. */
  inputSha256?: string | null;
  captureId?: string | null;
  matterId?: string | null;
  /** The input held instruction-like content. */
  suspicious?: boolean;
  /** Job id + task; unique per workspace. */
  idempotencyKey?: string | null;
}

/** An input that breaks the contract (an L5 level or a source with more than id and anchor). */
export class AiCallContractError extends Error {
  readonly code = 'AI_CALL_CONTRACT' as const;

  constructor(message: string) {
    super(message);
    this.name = 'AiCallContractError';
  }
}

function assertContract(input: AiCallInput): void {
  if (![1, 2, 3, 4].includes(input.automationLevel)) {
    throw new AiCallContractError('ai_call automationLevel must be 1-4 (the ladder stops at L4)');
  }
  for (const source of input.sources ?? []) {
    const extra = Object.keys(source).filter((key) => key !== 'id' && key !== 'anchor');
    if (typeof source.id !== 'string' || extra.length > 0) {
      throw new AiCallContractError(
        `ai_call sources hold ids and anchors only (got ${extra.join(', ') || 'no id'})`,
      );
    }
  }
}

/**
 * Insert one `ai_call` row for `workspaceId` (a savepoint pinned to it when `db` is the caller's
 * transaction). Returns the row id.
 */
export async function recordAiCall(
  db: Queryable,
  workspaceId: string,
  input: AiCallInput,
): Promise<{ id: string }> {
  assertContract(input);
  const [row] = await withWorkspace(db, { workspaceId }, (tx) =>
    tx
      .insert(schema.aiCall)
      .values({
        workspaceId,
        userId: input.userId ?? null,
        purpose: input.purpose,
        provider: input.provider,
        model: input.model,
        modelVersion: input.modelVersion ?? null,
        region: input.region,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costPaise: input.costPaise,
        sources: (input.sources ?? []).map((s) =>
          s.anchor === undefined ? { id: s.id } : { id: s.id, anchor: s.anchor },
        ),
        confidence:
          input.confidence === undefined || input.confidence === null
            ? null
            : input.confidence.toFixed(3),
        automationLevel: input.automationLevel,
        autoApplied: input.autoApplied ?? false,
        userAction: input.userAction ?? null,
        task: input.task ?? null,
        latencyMs: input.latencyMs ?? null,
        status: input.status ?? 'ok',
        errorCode: input.errorCode ?? null,
        inputSha256: input.inputSha256 ?? null,
        captureId: input.captureId ?? null,
        matterId: input.matterId ?? null,
        suspicious: input.suspicious ?? false,
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .returning({ id: schema.aiCall.id }),
  );
  if (!row) throw new Error('recordAiCall: insert returned no row');
  return row;
}
