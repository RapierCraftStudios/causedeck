import { describe, expect, it, vi } from 'vitest';

import { harness, ctx } from '../__tests__/helpers.ts';
import { PlanLimitReachedError, PlanUnavailableError, ProviderError } from '../errors.ts';
import { createGateway } from '../gateway.ts';
import { getTask } from '../tasks/registry.ts';
import {
  buildResponsesRequest,
  CHATGPT_PLAN_RESPONSES_URL,
  createChatgptPlanProvider,
  type ChatgptPlanTokenSource,
} from './chatgpt-plan.ts';

const matterInput = {
  question: 'surgery without informed consent',
  sources: [
    {
      id: 'doc:d1:2',
      text: 'The patient was operated. The surgery was done without informed consent.',
    },
    { id: 'fact:f1', text: 'Costs were awarded.' },
  ],
};
const researchInput = {
  query: 'surgery without informed consent',
  segments: [
    {
      id: 's1',
      text: 'The patient was operated. The surgery was done without informed consent.',
    },
    { id: 's2', text: 'Costs were awarded.' },
  ],
};

const ACCESS = 'access-token-AAA';

function sse(events: unknown[], chunkSize = 17): ReadableStream<Uint8Array> {
  const text = events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

const completed = (text: string): unknown[] => [
  { type: 'response.created', response: { id: 'r1' } },
  { type: 'response.output_text.delta', delta: text.slice(0, 5) },
  { type: 'response.output_text.delta', delta: text.slice(5) },
  {
    type: 'response.completed',
    response: {
      model: 'gpt-test-2026',
      output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
      usage: { input_tokens: 120, output_tokens: 30 },
    },
  },
];

function tokens(): ChatgptPlanTokenSource & { refreshed: number } {
  let current = ACCESS;
  const source = {
    refreshed: 0,
    accessToken: () => Promise.resolve(current),
    invalidate: () => {
      source.refreshed += 1;
      current = `${ACCESS}-refreshed`;
    },
  };
  return source;
}

type Reply = Response | (() => Response);

function fetchMock(...replies: Reply[]) {
  return vi.fn((_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const next = replies.shift();
    if (next === undefined) return Promise.reject(new Error('unexpected fetch'));
    return Promise.resolve(typeof next === 'function' ? next() : next);
  });
}

const ok = (events: unknown[]): Response =>
  new Response(sse(events), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status });

const noRetry = { maxAttempts: 1 };

describe('chatgpt-plan request', () => {
  it('posts to the Responses API with the bearer token and SSE accept', async () => {
    const f = fetchMock(ok(completed('{"answer":"x"}')));
    const provider = createChatgptPlanProvider({ model: 'gpt-test', tokens: tokens(), fetch: f });
    await provider.call(getTask('answer_matter_question'), matterInput, { suspicious: false });
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe(CHATGPT_PLAN_RESPONSES_URL);
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${ACCESS}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Accept).toBe('text/event-stream');
  });

  it('sends exactly the allowed body keys, store false and stream true', async () => {
    const f = fetchMock(ok(completed('{}')));
    const provider = createChatgptPlanProvider({ model: 'gpt-test', tokens: tokens(), fetch: f });
    await provider.call(getTask('answer_research_query'), researchInput, { suspicious: false });
    const body = JSON.parse(String(f.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['input', 'instructions', 'model', 'store', 'stream', 'text'].sort(),
    );
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('gpt-test');
    for (const field of [
      'temperature',
      'top_p',
      'max_output_tokens',
      'metadata',
      'user',
      'previous_response_id',
      'background',
      'conversation',
      'truncation',
    ]) {
      expect(body).not.toHaveProperty(field);
    }
    expect(body.text).toMatchObject({
      format: { type: 'json_schema', name: 'answer_research_query', strict: false },
    });
    expect(JSON.stringify(body.input)).toContain('DOCUMENT_DATA');
  });

  it('adds the repair note on the repair attempt only', () => {
    const task = getTask('answer_matter_question');
    const plain = buildResponsesRequest('m', task, matterInput, { suspicious: false });
    const repair = buildResponsesRequest('m', task, matterInput, {
      suspicious: false,
      repair: { issues: 'claims: invalid_type' },
    });
    expect(plain.input[0]?.content).toHaveLength(1);
    expect(repair.input[0]?.content[1]?.text).toContain('claims: invalid_type');
    expect(plain.instructions).toContain('JSON schema');
  });
});

describe('chatgpt-plan stream', () => {
  it('succeeds on response.completed with output text and usage', async () => {
    const provider = createChatgptPlanProvider({
      model: 'gpt-test',
      tokens: tokens(),
      fetch: fetchMock(ok(completed('{"a":1}'))),
    });
    const result = await provider.call(getTask('answer_matter_question'), matterInput, {
      suspicious: false,
    });
    expect(result).toMatchObject({
      output: '{"a":1}',
      usage: { inputTokens: 120, outputTokens: 30 },
      model: 'gpt-test',
    });
  });

  it('falls back to the accumulated deltas when the completed event has no output', async () => {
    const events = [
      { type: 'response.output_text.delta', delta: '{"b"' },
      { type: 'response.output_text.delta', delta: ':2}' },
      { type: 'response.completed', response: {} },
    ];
    const provider = createChatgptPlanProvider({
      model: 'gpt-test',
      tokens: tokens(),
      fetch: fetchMock(ok(events)),
    });
    const result = await provider.call(getTask('answer_matter_question'), matterInput, {
      suspicious: false,
    });
    expect(result.output).toBe('{"b":2}');
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('rejects a stream that ends without response.completed', async () => {
    const provider = createChatgptPlanProvider({
      model: 'gpt-test',
      tokens: tokens(),
      fetch: fetchMock(ok([{ type: 'response.output_text.delta', delta: '{"a":1}' }])),
      retry: noRetry,
    });
    const call = provider.call(getTask('answer_matter_question'), matterInput, {
      suspicious: false,
    });
    await expect(call).rejects.toBeInstanceOf(ProviderError);
  });

  it('rejects response.incomplete', async () => {
    const provider = createChatgptPlanProvider({
      model: 'gpt-test',
      tokens: tokens(),
      fetch: fetchMock(ok([{ type: 'response.incomplete', response: {} }])),
      retry: noRetry,
    });
    await expect(
      provider.call(getTask('answer_matter_question'), matterInput, { suspicious: false }),
    ).rejects.toThrow(/incomplete/);
  });
});

describe('chatgpt-plan errors', () => {
  const task = getTask('answer_matter_question');

  it('maps a 429 usage-limit reply to PlanLimitReachedError, without retrying', async () => {
    const f = fetchMock(
      json(429, { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'x' } }),
    );
    const provider = createChatgptPlanProvider({ model: 'm', tokens: tokens(), fetch: f });
    const error = await provider.call(task, matterInput, { suspicious: false }).catch((e) => e);
    expect(error).toBeInstanceOf(PlanLimitReachedError);
    expect((error as PlanLimitReachedError).code).toBe('PLAN_LIMIT_REACHED');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('maps a mid-stream response.failed with the limit code to PlanLimitReachedError', async () => {
    const f = fetchMock(
      ok([
        { type: 'response.output_text.delta', delta: '{"answer":"invented' },
        {
          type: 'response.failed',
          response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } },
        },
      ]),
    );
    const provider = createChatgptPlanProvider({ model: 'm', tokens: tokens(), fetch: f });
    await expect(provider.call(task, matterInput, { suspicious: false })).rejects.toBeInstanceOf(
      PlanLimitReachedError,
    );
  });

  it('maps an error event with the limit code to PlanLimitReachedError', async () => {
    const f = fetchMock(
      ok([{ type: 'error', code: 'subscription_sharing_usage_limit_exceeded', message: 'm' }]),
    );
    const provider = createChatgptPlanProvider({ model: 'm', tokens: tokens(), fetch: f });
    await expect(provider.call(task, matterInput, { suspicious: false })).rejects.toBeInstanceOf(
      PlanLimitReachedError,
    );
  });

  it.each([
    [503, { error: { code: 'subscription_sharing_usage_unavailable' } }],
    [403, { error: { code: 'subscription_sharing_user_unavailable' } }],
    [503, { error: { message: 'down' } }],
  ])('maps HTTP %i %j to PlanUnavailableError', async (status, body) => {
    const f = fetchMock(json(status, body));
    const provider = createChatgptPlanProvider({ model: 'm', tokens: tokens(), fetch: f });
    await expect(provider.call(task, matterInput, { suspicious: false })).rejects.toBeInstanceOf(
      PlanUnavailableError,
    );
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('invalidates the token on 401 and retries once with the refreshed token', async () => {
    const t = tokens();
    const f = fetchMock(json(401, { error: { code: 'invalid_token' } }), ok(completed('{}')));
    const provider = createChatgptPlanProvider({ model: 'm', tokens: t, fetch: f });
    await provider.call(task, matterInput, { suspicious: false });
    expect(t.refreshed).toBe(1);
    expect(f).toHaveBeenCalledTimes(2);
    const second = f.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(second.Authorization).toBe(`Bearer ${ACCESS}-refreshed`);
  });

  it('other HTTP errors are ProviderErrors with the status and no token or body text', async () => {
    const f = fetchMock(json(400, { error: { message: `bad ${ACCESS} ${matterInput.question}` } }));
    const provider = createChatgptPlanProvider({
      model: 'm',
      tokens: tokens(),
      fetch: f,
      retry: noRetry,
    });
    const error = (await provider
      .call(task, matterInput, { suspicious: false })
      .catch((e: unknown) => e)) as ProviderError;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.status).toBe(400);
    expect(error.message).not.toContain(ACCESS);
    expect(error.message).not.toContain('informed consent');
  });
});

describe('chatgpt-plan through the gateway', () => {
  it('returns the parsed model answer for answer_matter_question', async () => {
    const answer = {
      answer: 'The surgery was done without informed consent.',
      claims: [
        {
          statement: 'No informed consent was taken.',
          sourceId: 'doc:d1:2',
          quote: 'The surgery was done without informed consent.',
        },
      ],
    };
    const task = getTask('answer_matter_question');
    expect(task.output.safeParse(answer).success).toBe(true);
    const f = fetchMock(ok(completed(JSON.stringify(answer))));
    const h = harness({ previewPlanProvider: true });
    const gateway = createGateway({
      providers: [createChatgptPlanProvider({ model: 'gpt-test', tokens: tokens(), fetch: f })],
      ports: h.ports,
    });
    const result = await gateway.run('answer_matter_question', matterInput, ctx);
    expect(result.output).toEqual(answer);
    expect(result.provider).toBe('chatgpt-plan');
    expect(result.usage.costPaise).toBe(0);
    expect(h.audit[0]).toMatchObject({ provider: 'chatgpt-plan', model: 'gpt-test', status: 'ok' });
  });

  it('returns the parsed model answer for answer_research_query', async () => {
    const answer = {
      answer: 'Surgery without informed consent was held negligent.',
      claims: [
        {
          statement: 'Consent was not taken.',
          segmentId: 's1',
          quote: 'The surgery was done without informed consent.',
        },
      ],
    };
    const task = getTask('answer_research_query');
    expect(task.output.safeParse(answer).success).toBe(true);
    const f = fetchMock(ok(completed(JSON.stringify(answer))));
    const gateway = createGateway({
      providers: [createChatgptPlanProvider({ model: 'gpt-test', tokens: tokens(), fetch: f })],
      ports: harness({ previewPlanProvider: true }).ports,
    });
    const result = await gateway.run('answer_research_query', researchInput, ctx);
    expect(result.output).toEqual(answer);
  });

  it('surfaces the plan limit as PlanLimitReachedError, never an answer', async () => {
    const f = fetchMock(json(429, { error: { code: 'subscription_sharing_usage_limit_exceeded' } }));
    const h = harness({ previewPlanProvider: true });
    const gateway = createGateway({
      providers: [createChatgptPlanProvider({ model: 'gpt-test', tokens: tokens(), fetch: f })],
      ports: h.ports,
    });
    await expect(
      gateway.run('answer_matter_question', matterInput, ctx),
    ).rejects.toBeInstanceOf(PlanLimitReachedError);
    expect(h.audit[0]).toMatchObject({ status: 'error', errorCode: 'PLAN_LIMIT_REACHED' });
  });
});
