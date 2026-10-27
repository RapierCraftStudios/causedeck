import type { z } from 'zod';

import type { AutomationLevel } from './ports.ts';

export const TASK_IDS = [
  'classify_document',
  'extract_order',
  'ocr',
  'transcribe',
  'structure_hearing',
  'structure_diary',
  'structure_chat',
  'parse_list_a0',
  'parse_order_a0',
  'translate',
  'summarise',
  'tag_news',
  'tag_notice',
  'extract_issue_tags',
  'outward_update',
] as const;

export type TaskId = (typeof TASK_IDS)[number];

export type ProviderId = 'bedrock' | 'sarvam' | 'mock';

export interface TaskDef<I = unknown, O = unknown> {
  id: TaskId;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  /** Real providers in failover order. The mock provider serves every task in mock mode. */
  providers: readonly ProviderId[];
  maxOutputTokens: number;
  promptId: string;
  defaultLevel?: AutomationLevel;
  /** `drafting` selects the Sonnet-class model on Bedrock; default `fast` (Haiku-class). */
  tier?: 'fast' | 'drafting';
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Audio seconds (STT). */
  seconds?: number;
  /** Document pages (OCR). */
  pages?: number;
  /** Characters (translate). */
  chars?: number;
}

export interface ProviderResult {
  /** Parsed JSON, or the raw text when the model did not return JSON. */
  output: unknown;
  usage: Usage;
  model: string;
  modelVersion?: string | null;
}

export interface CallOptions {
  /** Set on the single repair attempt: why the previous output failed (paths only). */
  repair?: { issues: string };
  /** The input held instruction-like content. */
  suspicious: boolean;
}

export interface Provider {
  readonly id: ProviderId;
  readonly region: string;
  /** `in` only for in-region India processing. */
  readonly dataResidency: 'in' | 'other';
  readonly supports: readonly TaskId[];
  /** The model this provider will use for `task`, for pricing before the call. */
  modelFor(task: TaskDef): string;
  call(task: TaskDef, input: unknown, opts: CallOptions): Promise<ProviderResult>;
}

export interface RunContext {
  workspaceId: string;
  matterId?: string;
  captureId?: string;
  userId?: string;
  /** Dotted lowercase identifier, e.g. `capture.ocr`; also the budget reservation purpose. */
  purpose: string;
  automationLevel?: AutomationLevel;
  /** Job id; combined with the task id so a retry reuses the stored result. */
  idempotencyKey?: string;
}

export interface GatewayResult<O = unknown> {
  output: O;
  callId: string;
  provider: ProviderId;
  model: string;
  region: string;
  usage: Usage & { costPaise: number };
}
