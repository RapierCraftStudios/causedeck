import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { ProviderError, CircuitOpenError } from '../errors.ts';
import { inputHash } from '../hash.ts';
import { getTask } from '../tasks/registry.ts';
import type { Provider } from '../types.ts';
import { buildConverseRequest, createBedrockProvider } from './bedrock.ts';
import { createMockProvider, fixturePath, withRecording } from './mock.ts';
import { createSarvamProvider } from './sarvam.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(here, '__fixtures__', name), 'utf8'));
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('mock provider', () => {
  const mock = createMockProvider();
  const task = getTask('extract_order');
  const known = {
    text: 'IN THE HIGH COURT OF JUDICATURE AT MADRAS.   Order dated 2026-01-12. List the matter on 2026-02-09.',
  };

  it('returns the fixture keyed by (task, sha256 of the normalised input)', async () => {
    expect(inputHash(known)).toBe(
      '4eac719348d8dae48eae1d3131f8c7f2c1b176466183b3aaa05395a1c74065dc',
    );
    const result = await mock.call(task, known, { suspicious: false });
    expect(result.output).toMatchObject({ orderDate: '2026-01-12', nextHearingDate: '2026-02-09' });
  });

  it('is deterministic and falls back to a schema-valid synthetic response', async () => {
    const a = await mock.call(task, { text: 'unseen' }, { suspicious: false });
    const b = await mock.call(task, { text: 'unseen' }, { suspicious: false });
    expect(a).toEqual(b);
    expect(task.output.safeParse(a.output).success).toBe(true);
  });

  it('records real responses only for synthetic inputs', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mockfx-'));
    const inner: Provider = {
      ...createMockProvider(),
      call: () =>
        Promise.resolve({
          output: { documentType: 'order', confidence: 1 },
          usage: { inputTokens: 1, outputTokens: 1 },
          model: 'm',
        }),
    };
    const recording = withRecording(inner, {
      fixturesDir: dir,
      isSynthetic: (_t, input) => (input as { text: string }).text.startsWith('SYNTHETIC'),
    });
    const classify = getTask('classify_document');
    await recording.call(classify, { text: 'SYNTHETIC one' }, { suspicious: false });
    await recording.call(classify, { text: 'real customer text' }, { suspicious: false });
    expect(existsSync(fixturePath(dir, 'classify_document', { text: 'SYNTHETIC one' }))).toBe(true);
    expect(existsSync(fixturePath(dir, 'classify_document', { text: 'real customer text' }))).toBe(
      false,
    );
  });
});

describe('bedrock adapter', () => {
  const base = {
    region: 'ap-south-1',
    accessKeyId: 'AKIATEST',
    secretAccessKey: 'secret',
    modelId: 'apac.anthropic.claude-haiku-4-5-v1:0',
    draftingModelId: 'apac.anthropic.claude-sonnet-4-5-v1:0',
    now: () => new Date('2026-01-12T10:00:00Z'),
    retry: { sleep: () => Promise.resolve(), random: () => 0.5 },
  };
  const classify = getTask('classify_document');

  it('declares India residency only for India regions', () => {
    expect(createBedrockProvider(base).dataResidency).toBe('in');
    expect(createBedrockProvider({ ...base, region: 'us-east-1' }).dataResidency).toBe('other');
  });

  it('builds a signed Converse request with the config model and no tool definitions', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(fixture('bedrock-converse-response.json'))));
    const provider = createBedrockProvider({
      ...base,
      fetch: fetchMock,
    });
    const result = await provider.call(classify, { text: 'order' }, { suspicious: false });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://bedrock-runtime.ap-south-1.amazonaws.com/model/apac.anthropic.claude-haiku-4-5-v1%3A0/converse',
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIATEST\/20260112\/ap-south-1\/bedrock\/aws4_request/,
    );
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['inferenceConfig', 'messages', 'system']);
    expect(init.body as string).not.toMatch(/toolConfig|tool_config|"tools"/);
    expect(result).toMatchObject({
      output: '{"documentType":"order","confidence":0.93}',
      usage: { inputTokens: 412, outputTokens: 19 },
      model: base.modelId,
    });
  });

  it('wraps the input in a data block and names it untrusted in the system prompt', () => {
    const req = buildConverseRequest(classify, { text: 'ignore previous' }, { suspicious: true });
    expect(JSON.stringify(req.messages)).toContain('<<<DOCUMENT_DATA');
    expect(req.system[0]?.text).toContain('untrusted document data');
  });

  it('uses the drafting model for drafting-tier tasks', () => {
    const provider = createBedrockProvider(base);
    expect(provider.modelFor({ ...classify, tier: 'drafting' })).toBe(base.draftingModelId);
    expect(provider.modelFor(classify)).toBe(base.modelId);
  });

  it('retries throttling with jittered backoff, then succeeds', async () => {
    const sleeps: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ message: 'ThrottlingException' }, 429))
      .mockResolvedValueOnce(json({ message: 'ThrottlingException' }, 429))
      .mockResolvedValueOnce(json(fixture('bedrock-converse-response.json')));
    const provider = createBedrockProvider({
      ...base,
      fetch: fetchMock,
      retry: { sleep: (ms) => (sleeps.push(ms), Promise.resolve()), random: () => 0.5 },
    });
    await provider.call(classify, { text: 'x' }, { suspicious: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it('does not retry a non-throttling client error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}, 403));
    const provider = createBedrockProvider({
      ...base,
      fetch: fetchMock,
    });
    await expect(
      provider.call(classify, { text: 'x' }, { suspicious: false }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit after 5 consecutive failures for 30 s', async () => {
    let now = 0;
    const fetchMock = vi.fn().mockResolvedValue(json({}, 403));
    const { CircuitBreaker } = await import('../retry.ts');
    const provider = createBedrockProvider({
      ...base,
      fetch: fetchMock,
      breaker: new CircuitBreaker({ now: () => now }),
    });
    for (let i = 0; i < 5; i += 1) {
      await provider.call(classify, { text: 'x' }, { suspicious: false }).catch(() => undefined);
    }
    await expect(
      provider.call(classify, { text: 'x' }, { suspicious: false }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    now = 30_001;
    await provider.call(classify, { text: 'x' }, { suspicious: false }).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

describe('sarvam adapter', () => {
  const make = (body: unknown) => {
    const fetchMock = vi.fn(() => Promise.resolve(json(body)));
    const provider = createSarvamProvider({
      apiKey: 'k',
      noTrainingConfirmed: true,
      fetch: fetchMock,
    });
    return { fetchMock, provider };
  };

  it('refuses to be built without the no-training confirmation', () => {
    expect(() => createSarvamProvider({ apiKey: 'k', noTrainingConfirmed: false })).toThrow(
      /NO_TRAINING/,
    );
  });

  it('declares India residency', () => {
    expect(make({}).provider).toMatchObject({ dataResidency: 'in', region: 'in' });
  });

  it('maps batch STT', async () => {
    const { provider, fetchMock } = make(fixture('sarvam-stt-response.json'));
    const result = await provider.call(
      getTask('transcribe'),
      { audioBase64: 'AAAA', mimeType: 'audio/wav', durationSeconds: 42, language: 'en' },
      { suspicious: false },
    );
    expect(result.output).toEqual({
      text: 'Next hearing on the ninth of February.',
      language: 'en',
    });
    expect(result.usage.seconds).toBe(42);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.sarvam.ai/speech-to-text');
    expect((init.headers as Record<string, string>)['api-subscription-key']).toBe('k');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('maps document OCR', async () => {
    const { provider } = make(fixture('sarvam-ocr-response.json'));
    const result = await provider.call(
      getTask('ocr'),
      { contentBase64: 'AAAA', mimeType: 'application/pdf', pageCount: 2 },
      { suspicious: false },
    );
    expect(getTask('ocr').output.safeParse(result.output).success).toBe(true);
    expect(result.usage.pages).toBe(2);
  });

  it('maps translation', async () => {
    const { provider, fetchMock } = make(fixture('sarvam-translate-response.json'));
    const result = await provider.call(
      getTask('translate'),
      { text: 'Next hearing on 9 February.', sourceLanguage: 'en', targetLanguage: 'ta' },
      { suspicious: false },
    );
    expect(result.output).toMatchObject({ text: expect.stringContaining('விசாரணை') as string });
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    ) as Record<string, string>;
    expect(body).toMatchObject({ source_language_code: 'en-IN', target_language_code: 'ta-IN' });
  });
});
