// The platform scope of the AI gateway (#1030): calls that belong to no workspace, today the OCR
// of global corpus pages. The ports are the workspace ports' counterparts on `corpus_ocr_call`
// (global, no workspace_id): the audit row, a daily spend cap and the policy. Nothing here reads
// or writes a tenant table, so platform spend can never land on a workspace's `ai_call`, usage
// events or budget. India-only mode stays on and the sensitive-matter checks do not apply (the
// corpus is public).
import {
  createGateway,
  createMockProvider,
  type AiGateway,
  type BudgetReservation,
  type GatewayPorts,
  type Provider,
} from '@causedeck/ai';
import { schema, type Queryable } from '@causedeck/db';
import { gte, sql } from 'drizzle-orm';

const { corpusOcrCall } = schema;

/** The `workspaceId` the gateway sees for platform calls; never a workspace id. */
export const PLATFORM_AI_SCOPE = 'platform';

/** Default daily platform OCR budget, in paise. */
export const DEFAULT_PLATFORM_OCR_DAILY_PAISE = 500_000;

export interface PlatformAiOptions {
  now?: () => Date;
  /** Paise the platform scope may spend per UTC day on OCR. */
  dailyPaise?: number;
  providers?: readonly Provider[];
}

const startOfUtcDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Gateway ports for the platform scope, metered in `corpus_ocr_call`. */
export function createPlatformAiPorts(db: Queryable, options: PlatformAiOptions = {}): GatewayPorts {
  const now = options.now ?? (() => new Date());
  const dailyPaise = options.dailyPaise ?? DEFAULT_PLATFORM_OCR_DAILY_PAISE;
  const held = new Map<string, number>();
  let counter = 0;
  const heldPaise = (): number => [...held.values()].reduce((a, b) => a + b, 0);

  return {
    budget: {
      async reserve(_scope, estimatedPaise): Promise<BudgetReservation> {
        const [row] = await db
          .select({ spent: sql<number>`coalesce(sum(${corpusOcrCall.costPaise}), 0)::int` })
          .from(corpusOcrCall)
          .where(and(gte(corpusOcrCall.createdAt, startOfUtcDay(now()))));
        if ((row?.spent ?? 0) + heldPaise() + estimatedPaise > dailyPaise) {
          throw Object.assign(new Error('platform OCR budget spent for today'), {
            code: 'BUDGET_EXCEEDED',
          });
        }
        counter += 1;
        const id = `platform-${String(counter)}`;
        held.set(id, estimatedPaise);
        return { id };
      },
      commit(_scope, reservation) {
        held.delete(reservation.id);
        return Promise.resolve();
      },
      release(_scope, reservation) {
        held.delete(reservation.id);
        return Promise.resolve();
      },
    },
    settings: {
      getPolicy: () =>
        Promise.resolve({ indiaOnly: true, matterSensitive: false, captureAiBlocked: false }),
    },
    audit: {
      async record(_scope, record) {
        const [row] = await db
          .insert(corpusOcrCall)
          .values({
            purpose: record.purpose,
            task: record.task,
            provider: record.provider,
            model: record.model,
            region: record.region,
            inputTokens: record.inputTokens,
            outputTokens: record.outputTokens,
            costPaise: record.costPaise,
            status: record.status,
            errorCode: record.errorCode ?? null,
            inputSha256: record.inputSha256,
            latencyMs: record.latencyMs,
          })
          .returning({ id: corpusOcrCall.id });
        if (row === undefined) throw new Error('corpus_ocr_call insert returned no row');
        return { id: row.id };
      },
    },
  };
}

/** A gateway for the platform scope. With no providers, the deterministic mock serves OCR. */
export function createPlatformAiGateway(
  db: Queryable,
  options: PlatformAiOptions = {},
): AiGateway {
  const providers = options.providers?.length ? options.providers : [createMockProvider()];
  return createGateway({
    providers,
    ports: createPlatformAiPorts(db, options),
    now: options.now ?? (() => new Date()),
  });
}
