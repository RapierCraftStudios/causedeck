// Shared test helpers for the A0 adapter (#56): a counting fake gateway, page builders and a
// "recorded model" that answers from a synthetic document's truth, so no test needs a real model.
import type { AiGateway, GatewayResult, RunContext } from '@causedeck/ai';
import type { PageText } from '@causedeck/intelligence/extract';

import type { GeneratedA0Document } from '../synthetic/generate.ts';
import type { ModelA0OrderOutput, ModelListOutput } from '../validate.ts';

export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

export const pagesOf = (texts: readonly string[]): PageText[] =>
  texts.map((text, index) => ({ pageNo: index + 1, text, textSource: 'layer' as const }));

export interface GatewayCall {
  task: string;
  input: unknown;
  ctx: RunContext;
}

/** A gateway that answers from `handler`, counts its calls and can fail or stall on demand. */
export function fakeGateway(
  handler: (task: string, input: unknown) => unknown,
  options: { latencyMs?: (call: number) => number; fail?: { code: string } } = {},
): { gateway: AiGateway; calls: GatewayCall[] } {
  const calls: GatewayCall[] = [];
  const gateway: AiGateway = {
    async run<O>(task: string, input: unknown, ctx: RunContext): Promise<GatewayResult<O>> {
      calls.push({ task, input, ctx });
      const wait = options.latencyMs?.(calls.length) ?? 0;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      if (options.fail !== undefined) {
        throw Object.assign(new Error('gateway failure'), { code: options.fail.code });
      }
      return {
        output: handler(task, input) as O,
        callId: `call-${String(calls.length)}`,
        provider: 'mock',
        model: 'mock',
        region: 'local',
        usage: { inputTokens: 0, outputTokens: 0, costPaise: 0 },
      };
    },
  };
  return { gateway, calls };
}

export const scope = { workspaceId: 'ws-1' } as const;

const caseText = (c: { caseTypeRaw: string; caseNumber: string; caseYear: number }): string =>
  `${c.caseTypeRaw} No. ${c.caseNumber}/${String(c.caseYear)}`;

/** The line of `texts` for which `test` is true, with its 1-based page. */
export function findLine(
  texts: readonly string[],
  test: (line: string) => boolean,
): { page: number; line: string } | null {
  for (const [index, text] of texts.entries()) {
    const line = text.split('\n').find(test);
    if (line !== undefined) return { page: index + 1, line };
  }
  return null;
}

/** What a correct model returns for a synthetic list, plus faults a hostile or sloppy one adds. */
export function recordedListModel(
  doc: GeneratedA0Document,
  options: { faults?: boolean } = {},
): ModelListOutput {
  const rows: ModelListOutput['rows'] = [];
  for (const c of doc.truth.cases) {
    const hit = findLine(doc.pages, (line) => line.includes(caseText(c)));
    if (hit === null) continue;
    rows.push({
      page: hit.page,
      quote: hit.line,
      caseNumber: caseText(c),
      cnr: c.cnr ?? null,
      serial: null,
      parties: null,
      stageText: null,
      hall: null,
      // A claimed date that no line contains: it must never survive.
      dates: options.faults === true ? ['2031-01-01'] : [],
    });
  }
  if (options.faults === true) {
    rows.push(
      {
        page: 1,
        quote: 'O.S. No. 9999/2031 This line does not exist on the page',
        caseNumber: 'O.S. No. 9999/2031',
        cnr: null,
        serial: null,
        parties: null,
        stageText: null,
        hall: null,
        dates: [],
      },
      {
        // A real line, but the model claims a different case number than the line holds.
        page: rows[0]?.page ?? 1,
        quote: rows[0]?.quote ?? 'x',
        caseNumber: 'Crl.Misc. No. 8888/2031',
        cnr: null,
        serial: null,
        parties: null,
        stageText: null,
        hall: null,
        dates: [],
      },
    );
  }
  return {
    listDate:
      doc.truth.listDate === undefined
        ? null
        : (() => {
            const hit = findLine(doc.pages, (l) => /\d{4}|[௦-௯೦-೯]{4}/u.test(l) && !/No\./.test(l));
            return hit === null
              ? null
              : { date: doc.truth.listDate, page: hit.page, quote: hit.line };
          })(),
    rows,
    confidence: 0.9,
  };
}

/** What a correct model returns for a synthetic order. */
export function recordedOrderModel(doc: GeneratedA0Document): ModelA0OrderOutput {
  const texts = doc.pages;
  const c = doc.truth.cases[0];
  const caseHit = c === undefined ? null : findLine(texts, (line) => line.includes(caseText(c)));
  const orderLine = findLine(texts, (line) => /^(Dated:|தேதி:|ದಿನಾಂಕ:)/.test(line));
  const orderIdx = texts.join('\n').split('\n');
  const afterOrder = orderIdx[orderIdx.indexOf('ORDER') + 1];
  const direction =
    afterOrder === undefined ? null : findLine(texts, (line) => line === afterOrder);
  const relative = findLine(texts, (line) => line.startsWith('List after'));
  const post =
    doc.truth.nextDate === undefined || relative !== null
      ? null
      : findLine(
          texts,
          (line) =>
            line !== orderLine?.line &&
            /[\d௦-௯೦-೯]{1,2}\.[\d௦-௯೦-೯]{1,2}\.[\d௦-௯೦-೯]{4}/u.test(line) &&
            !/No\.|order dated/.test(line),
        );
  return {
    caseNumbers:
      c === undefined || caseHit === null
        ? []
        : [{ value: caseText(c), page: caseHit.page, quote: caseHit.line }],
    cnrs:
      c?.cnr === undefined
        ? []
        : (() => {
            const hit = findLine(texts, (line) => line.includes(c.cnr ?? ''));
            return hit === null ? [] : [{ value: c.cnr ?? '', page: hit.page, quote: hit.line }];
          })(),
    parties: [],
    orderDate:
      doc.truth.orderDate === undefined || orderLine === null
        ? null
        : { date: doc.truth.orderDate, page: orderLine.page, quote: orderLine.line },
    orderType: 'interim',
    directions:
      direction === null
        ? []
        : [
            {
              text: direction.line,
              kind: 'filing',
              dueExpression: null,
              dueDate: null,
              page: direction.page,
              quote: direction.line,
            },
          ],
    nextDate:
      relative !== null
        ? { date: null, phrase: 'List after four weeks', page: relative.page, quote: relative.line }
        : post === null || doc.truth.nextDate === undefined
          ? null
          : { date: doc.truth.nextDate, phrase: post.line, page: post.page, quote: post.line },
    confidence: 0.9,
  };
}
