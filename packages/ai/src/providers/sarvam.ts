// Sarvam adapter: batch speech-to-text, document OCR and translation, in-region (India). Request
// and response field names follow Sarvam's public API docs; the recorded fixtures under
// src/providers/__fixtures__ are hand-written from those docs until #113 provides a key to record
// real responses. Sarvam has no per-request retention or training parameter: no training is a
// contract term, confirmed by `SARVAM_NO_TRAINING_CONFIRMED`, and the adapter refuses to be built
// for production traffic without it.
import { ProviderError } from '../errors.ts';
import { CircuitBreaker, withRetry, type RetryOptions } from '../retry.ts';
import type { Provider, ProviderResult, TaskDef, TaskId } from '../types.ts';

export const SARVAM_TASKS: readonly TaskId[] = ['transcribe', 'ocr', 'translate'];

export interface SarvamConfig {
  apiKey: string;
  /** The contract flag `SARVAM_NO_TRAINING_CONFIRMED`; the adapter throws without it. */
  noTrainingConfirmed: boolean;
  baseUrl?: string;
  fetch?: typeof fetch;
  retry?: RetryOptions;
  breaker?: CircuitBreaker;
}

const LOCALE: Record<string, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  ta: 'ta-IN',
  kn: 'kn-IN',
  te: 'te-IN',
  ml: 'ml-IN',
  mr: 'mr-IN',
  bn: 'bn-IN',
  gu: 'gu-IN',
};
const FROM_LOCALE = Object.fromEntries(Object.entries(LOCALE).map(([k, v]) => [v, k]));
const locale = (code: unknown): string => LOCALE[String(code)] ?? 'en-IN';

interface Rec {
  [key: string]: unknown;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export function buildSarvamRequest(
  task: TaskDef,
  input: Rec,
): { path: string; body: FormData | string; json: boolean } {
  if (task.id === 'transcribe') {
    const form = new FormData();
    const bytes = Buffer.from(String(input.audioBase64), 'base64');
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: String(input.mimeType) }),
      'audio',
    );
    form.append('model', 'saarika:v2.5');
    form.append('language_code', input.language === undefined ? 'unknown' : locale(input.language));
    return { path: '/speech-to-text', body: form, json: false };
  }
  if (task.id === 'ocr') {
    const form = new FormData();
    const bytes = Buffer.from(String(input.contentBase64), 'base64');
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: String(input.mimeType) }),
      'document',
    );
    form.append('language', input.language === undefined ? 'en-IN' : locale(input.language));
    return { path: '/doc-digitization', body: form, json: false };
  }
  return {
    path: '/translate',
    body: JSON.stringify({
      input: input.text,
      source_language_code: locale(input.sourceLanguage),
      target_language_code: locale(input.targetLanguage),
      model: 'mayura:v1',
    }),
    json: true,
  };
}

export function mapSarvamResponse(task: TaskDef, input: Rec, json: Rec): ProviderResult {
  if (task.id === 'transcribe') {
    const code = str(json.language_code) || 'en-IN';
    const language = FROM_LOCALE[code] ?? 'en';
    const text = str(json.transcript);
    return {
      output: {
        text,
        language,
        segments: [
          {
            startMs: 0,
            endMs: Math.round(Number(input.durationSeconds ?? 0) * 1000),
            language,
            text,
          },
        ],
      },
      usage: { inputTokens: 0, outputTokens: 0, seconds: Number(input.durationSeconds ?? 0) },
      model: 'stt',
      modelVersion: 'saarika:v2.5',
    };
  }
  if (task.id === 'ocr') {
    const pages = (json.pages as Rec[] | undefined) ?? [];
    return {
      output: {
        pages: pages.map((p, i) => ({
          page: Number(p.page_number ?? i + 1),
          text: str(p.text),
        })),
        confidence: typeof json.confidence === 'number' ? json.confidence : 0.5,
      },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        pages: pages.length || Number(input.pageCount ?? 0),
      },
      model: 'ocr',
      modelVersion: 'doc-digitization',
    };
  }
  return {
    output: { text: str(json.translated_text) },
    usage: { inputTokens: 0, outputTokens: 0, chars: str(input.text).length },
    model: 'translate',
    modelVersion: 'mayura:v1',
  };
}

export function createSarvamProvider(config: SarvamConfig): Provider {
  if (!config.noTrainingConfirmed) {
    throw new Error(
      'Sarvam adapter requires SARVAM_NO_TRAINING_CONFIRMED (contract no-training term)',
    );
  }
  const doFetch = config.fetch ?? fetch;
  const baseUrl = config.baseUrl ?? 'https://api.sarvam.ai';
  const breaker = config.breaker ?? new CircuitBreaker();

  async function once(task: TaskDef, input: unknown): Promise<ProviderResult> {
    const rec = input as Rec;
    const req = buildSarvamRequest(task, rec);
    const headers: Record<string, string> = { 'api-subscription-key': config.apiKey };
    if (req.json) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${req.path}`, {
        method: 'POST',
        headers,
        body: req.body,
      });
    } catch {
      throw new ProviderError('sarvam', 'network error', { retryable: true });
    }
    if (!response.ok) {
      throw new ProviderError('sarvam', `HTTP ${String(response.status)}`, {
        retryable: response.status === 429 || response.status >= 500,
        status: response.status,
      });
    }
    return mapSarvamResponse(task, rec, (await response.json()) as Rec);
  }

  return {
    id: 'sarvam',
    region: 'in',
    dataResidency: 'in',
    supports: SARVAM_TASKS,
    modelFor: (task) => (task.id === 'transcribe' ? 'stt' : task.id),
    call: (task, input) =>
      breaker.run('sarvam', () => withRetry(() => once(task, input), config.retry)),
  };
}
