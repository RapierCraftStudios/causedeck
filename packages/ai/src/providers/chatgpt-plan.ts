// Preview-only ChatGPT plan adapter (#1165): OpenAI's Responses API through "Sign in with ChatGPT"
// plan usage. Demo workspaces only (see `policy/residency.ts`); production stays on Bedrock India
// (#112) and real client data never reaches this adapter.
//
// The request carries the model, instructions, one user message, `store: false`, `stream: true`
// and the task's JSON schema as the structured output format, nothing else: plan usage rejects
// sampling, length, metadata, user and conversation fields, and a static test forbids model-side
// actions. Success is only a `response.completed` event; the plan's usage-limit and unavailable
// codes map to typed errors that are never retried or failed over.
import { z } from 'zod';

import { PlanLimitReachedError, PlanUnavailableError, ProviderError } from '../errors.ts';
import { systemPrompt, wrapAsData } from '../policy/injection.ts';
import { withRetry, type RetryOptions } from '../retry.ts';
import type { CallOptions, Provider, ProviderResult, TaskDef, TaskId } from '../types.ts';

export const CHATGPT_PLAN_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export const CHATGPT_PLAN_TASKS: readonly TaskId[] = [
  'answer_matter_question',
  'answer_research_query',
];

/** Where the adapter gets a bearer token; `createChatgptPlanTokenStore` is the file-backed one. */
export interface ChatgptPlanTokenSource {
  accessToken(): Promise<string>;
  /** The server rejected the current token: the next `accessToken()` refreshes. */
  invalidate(): void;
}

export interface ChatgptPlanConfig {
  /** A model the signed-in account may use (GET /v1/models); CHATGPT_PLAN_MODEL. */
  model: string;
  tokens: ChatgptPlanTokenSource;
  fetch?: typeof fetch;
  retry?: RetryOptions;
}

export interface ResponsesRequest {
  model: string;
  instructions: string;
  input: { role: 'user'; content: { type: 'input_text'; text: string }[] }[];
  store: false;
  stream: true;
  text: {
    format: { type: 'json_schema'; name: string; schema: unknown; strict: false };
  };
}

const LIMIT_CODES = new Set(['subscription_sharing_usage_limit_exceeded']);
const UNAVAILABLE_CODES = new Set([
  'subscription_sharing_usage_unavailable',
  'subscription_sharing_user_unavailable',
]);

export function buildResponsesRequest(
  model: string,
  task: TaskDef,
  input: unknown,
  opts: CallOptions,
): ResponsesRequest {
  const schema = z.toJSONSchema(task.output);
  const user = [wrapAsData(task.promptId, JSON.stringify(input))];
  if (opts.repair !== undefined) {
    user.push(
      `Your previous reply failed validation (${opts.repair.issues}). Reply again with only the corrected JSON object.`,
    );
  }
  return {
    model,
    instructions: systemPrompt(task.promptId, JSON.stringify(schema)),
    input: [{ role: 'user', content: user.map((text) => ({ type: 'input_text', text })) }],
    store: false,
    stream: true,
    text: { format: { type: 'json_schema', name: task.id, schema, strict: false } },
  };
}

/** The typed error for an error `code` from the plan, or null when the code is not a plan code. */
function planError(code: unknown): Error | null {
  if (typeof code !== 'string') return null;
  if (LIMIT_CODES.has(code)) return new PlanLimitReachedError();
  if (UNAVAILABLE_CODES.has(code)) return new PlanUnavailableError();
  return null;
}

/** `error.code` (or `code`) from a JSON error body or event; never the message, which may echo input. */
function errorCode(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  const v = value as { code?: unknown; error?: unknown; response?: unknown };
  if (typeof v.code === 'string') return v.code;
  if (v.error !== undefined) return errorCode(v.error);
  if (v.response !== undefined) return errorCode(v.response);
  return undefined;
}

async function httpError(response: Response): Promise<Error> {
  let code: unknown;
  try {
    code = errorCode(JSON.parse(await response.text()) as unknown);
  } catch {
    code = undefined;
  }
  const typed = planError(code);
  if (typed !== null) return typed;
  if (response.status === 429) return new PlanLimitReachedError();
  if (response.status === 503) return new PlanUnavailableError();
  return new ProviderError('chatgpt-plan', `HTTP ${String(response.status)}`, {
    retryable: response.status >= 500,
    status: response.status,
  });
}

interface CompletedResponse {
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
}

/** Split an SSE body into parsed `data:` payloads. */
async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = function* (block: string): Generator<unknown> {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data === '' || data === '[DONE]') return;
    try {
      yield JSON.parse(data) as unknown;
    } catch {
      // A malformed event is skipped; success still needs `response.completed`.
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, '');
      yield* parse(block);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim() !== '') yield* parse(buffer);
}

/** Read the stream to `response.completed`; anything else is a typed failure. */
async function readStream(
  body: ReadableStream<Uint8Array>,
  model: string,
): Promise<ProviderResult> {
  let deltas = '';
  for await (const event of events(body)) {
    if (event === null || typeof event !== 'object') continue;
    const e = event as { type?: unknown; delta?: unknown; response?: CompletedResponse };
    switch (e.type) {
      case 'response.output_text.delta':
        if (typeof e.delta === 'string') deltas += e.delta;
        break;
      case 'response.completed': {
        const response = e.response ?? {};
        const text = (response.output ?? [])
          .flatMap((item) => item.content ?? [])
          .filter((c) => c.type === 'output_text')
          .map((c) => c.text ?? '')
          .join('');
        return {
          output: text === '' ? deltas : text,
          usage: {
            inputTokens: response.usage?.input_tokens ?? 0,
            outputTokens: response.usage?.output_tokens ?? 0,
          },
          model,
          modelVersion: typeof response.model === 'string' ? response.model : model,
        };
      }
      case 'response.failed':
      case 'error':
        throw planError(errorCode(event)) ?? new ProviderError('chatgpt-plan', 'response failed');
      case 'response.incomplete':
        throw new ProviderError('chatgpt-plan', 'response incomplete');
      default:
        break;
    }
  }
  throw new ProviderError('chatgpt-plan', 'stream ended before response.completed');
}

export function createChatgptPlanProvider(config: ChatgptPlanConfig): Provider {
  const doFetch = config.fetch ?? fetch;
  const modelFor = (): string => config.model;

  async function send(body: string): Promise<Response> {
    const token = await config.tokens.accessToken();
    try {
      return await doFetch(CHATGPT_PLAN_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body,
      });
    } catch {
      throw new ProviderError('chatgpt-plan', 'network error', { retryable: true });
    }
  }

  async function once(task: TaskDef, input: unknown, opts: CallOptions): Promise<ProviderResult> {
    const body = JSON.stringify(buildResponsesRequest(config.model, task, input, opts));
    let response = await send(body);
    if (response.status === 401) {
      // The access token was rejected: refresh it once and retry.
      await response.body?.cancel().catch(() => undefined);
      config.tokens.invalidate();
      response = await send(body);
    }
    if (!response.ok) throw await httpError(response);
    if (response.body === null) {
      throw new ProviderError('chatgpt-plan', 'empty response body');
    }
    return readStream(response.body, config.model);
  }

  return {
    id: 'chatgpt-plan',
    region: 'openai',
    dataResidency: 'other',
    supports: CHATGPT_PLAN_TASKS,
    modelFor,
    call: (task, input, opts) => withRetry(() => once(task, input, opts), config.retry),
  };
}
