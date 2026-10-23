// The extraction eval (#46): scores anchored extraction on the synthetic gold set with a recorded
// provider (no network, no model) and prints a per-field table. Targets (PRD NFR Accuracy): next
// date >= 98%, directions recall >= 90%, bench and case numbers >= 98%, anchor validity 100%, and
// ZERO hallucinated dates (any one fails the run). `ADAPTER_PRIVATE_FIXTURES_DIR` points at
// lawyer-supplied orders (`*.txt`, pages split by form feed, #119): they are run deterministically
// and reported separately, with no accuracy figures since nothing is labelled.
//   pnpm --filter @causedeck/intelligence eval
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { AiGateway } from '@causedeck/ai';

import { normaliseQuote, type PageText } from '../src/extract/anchors.ts';
import { datePresence } from '../src/extract/dates.ts';
import { extractOrder } from '../src/extract/order.ts';
import { addInterval } from '../src/extract/relative.ts';
import type { OrderExtraction } from '../src/extract/schema.ts';

import { generateGoldSet, type GoldOrder } from './gold/generate.ts';

const DOCUMENT_ID = '00000000-0000-4000-8000-000000000046';

export const TARGETS = {
  nextDate: 0.98,
  directionsRecall: 0.9,
  bench: 0.98,
  caseNumbers: 0.98,
  anchorValidity: 1,
} as const;

export interface FieldScore {
  field: string;
  correct: number;
  total: number;
  rate: number;
  target: number | null;
}

export interface EvalReport {
  orders: number;
  adversarial: number;
  fields: FieldScore[];
  hallucinatedDates: number;
  failures: string[];
  passed: boolean;
}

const pageMarkers = (pages: readonly { pageNo: number; text: string }[]): string =>
  pages.map((p) => `[[PAGE ${String(p.pageNo)}]]\n${p.text}`).join('\n\n');

/** A provider that returns the recorded output of the order whose text it is asked about. */
export function recordedGateway(orders: readonly GoldOrder[]): AiGateway {
  const gateway = {
    run: (_task: string, input: unknown) => {
      const text = (input as { text?: string }).text;
      const hit = orders.find((o) => pageMarkers(o.pages) === text);
      if (hit === undefined) throw new Error('no recorded output for this order');
      return Promise.resolve({
        output: hit.model,
        callId: '00000000-0000-4000-8000-0000000000ca',
        provider: 'mock' as const,
        model: 'mock',
        region: 'local',
        usage: { inputTokens: 0, outputTokens: 0, costPaise: 0 },
      });
    },
  };
  return gateway as unknown as AiGateway;
}

/** Dates the extraction asserts, with the page text each must be written in (derived ones aside). */
function assertedDates(
  e: OrderExtraction,
): { date: string; page: number; quote: string; derived: boolean }[] {
  const out: { date: string; page: number; quote: string; derived: boolean }[] = [];
  if (e.orderDate)
    out.push({ date: e.orderDate.date, ...pageQuote(e.orderDate.anchor), derived: false });
  for (const n of [...(e.nextDate ? [e.nextDate] : []), ...e.candidates]) {
    out.push({ date: n.date, ...pageQuote(n.anchor), derived: n.derived === true });
  }
  for (const d of e.directions) {
    if (d.dueDate !== undefined) {
      out.push({ date: d.dueDate, ...pageQuote(d.anchor), derived: d.derived === true });
    }
  }
  return out;
}
const pageQuote = (a: { page: number; quote: string }) => ({ page: a.page, quote: a.quote });

/** Count dates that neither appear in the cited text nor follow from a stated derivation. */
export function hallucinatedDates(e: OrderExtraction): number {
  const base = e.orderDate?.date;
  let bad = 0;
  for (const item of assertedDates(e)) {
    if (item.derived) {
      const derivations = [
        ...e.candidates,
        ...(e.nextDate ? [e.nextDate] : []),
        ...e.directions,
      ].flatMap((x) =>
        x.derivation === undefined || base === undefined
          ? []
          : [addInterval(base, x.derivation.n, x.derivation.unit)],
      );
      if (!derivations.includes(item.date)) bad += 1;
    } else if (datePresence(item.date, item.quote) === null) bad += 1;
  }
  return bad;
}

/** Every anchor quotes exactly the page text it points at. */
export function anchorsValid(
  e: OrderExtraction,
  pages: readonly PageText[],
): { ok: number; total: number } {
  const anchors = [
    ...e.bench.map((x) => x.anchor),
    ...e.caseNumbers.map((x) => x.anchor),
    ...e.directions.map((x) => x.anchor),
    ...e.candidates.map((x) => x.anchor),
    ...e.stageCues.map((x) => x.anchor),
    ...(e.orderDate ? [e.orderDate.anchor] : []),
    ...(e.neutralCitation ? [e.neutralCitation.anchor] : []),
    ...(e.nextDate ? [e.nextDate.anchor] : []),
  ];
  let ok = 0;
  for (const a of anchors) {
    const text = pages.find((p) => p.pageNo === a.page)?.text;
    if (
      text !== undefined &&
      normaliseQuote(text.slice(a.charStart, a.charEnd)) === normaliseQuote(a.quote)
    )
      ok += 1;
  }
  return { ok, total: anchors.length };
}

const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));
const loose = (s: string): string => s.toLowerCase().replace(/[\s.]+/g, '');

export async function runGoldEval(
  orders: readonly GoldOrder[] = generateGoldSet(),
): Promise<EvalReport> {
  const gateway = recordedGateway(orders);
  const tally = {
    next: 0,
    dirHit: 0,
    dirTotal: 0,
    bench: 0,
    cases: 0,
    anchorOk: 0,
    anchorTotal: 0,
    hallucinated: 0,
  };
  const failures: string[] = [];

  for (const order of orders) {
    const pages: PageText[] = order.pages.map((p) => ({ ...p, textSource: 'layer' }));
    const { extraction: e } = await extractOrder({
      documentId: DOCUMENT_ID,
      pipelineVersion: 'eval',
      pages,
      ai: { gateway, scope: { workspaceId: DOCUMENT_ID } },
    });
    const x = order.expected;

    const chose = e.nextDate?.date ?? null;
    const declined =
      x.nextDate === null &&
      chose === null &&
      e.ambiguous === x.ambiguous &&
      e.suspicious === x.suspicious &&
      x.candidates.every((d) => e.candidates.some((c) => c.date === d));
    if (x.nextDate !== null ? chose === x.nextDate && e.orderDate?.date === x.orderDate : declined)
      tally.next += 1;
    else failures.push(`${order.id}: next date ${String(chose)} (expected ${String(x.nextDate)})`);

    for (const q of x.directions) {
      tally.dirTotal += 1;
      if (e.directions.some((d) => d.anchor.quote.includes(q))) tally.dirHit += 1;
    }
    if (
      same(
        e.bench.map((b) => loose(b.name)),
        x.bench.map(loose),
      )
    )
      tally.bench += 1;
    else failures.push(`${order.id}: bench ${e.bench.map((b) => b.name).join(',')}`);
    if (
      same(
        e.caseNumbers.map((c) => loose(c.value)),
        x.caseNumbers.map(loose),
      )
    )
      tally.cases += 1;
    else failures.push(`${order.id}: case numbers ${e.caseNumbers.map((c) => c.value).join(',')}`);

    const anchors = anchorsValid(e, pages);
    tally.anchorOk += anchors.ok;
    tally.anchorTotal += anchors.total;
    const bad = hallucinatedDates(e);
    tally.hallucinated += bad;
    if (bad > 0) failures.push(`${order.id}: ${String(bad)} hallucinated date(s)`);
  }

  const n = orders.length;
  const score = (
    field: string,
    correct: number,
    total: number,
    target: number | null,
  ): FieldScore => ({
    field,
    correct,
    total,
    rate: total === 0 ? 1 : correct / total,
    target,
  });
  const fields = [
    score('next date', tally.next, n, TARGETS.nextDate),
    score('directions recall', tally.dirHit, tally.dirTotal, TARGETS.directionsRecall),
    score('bench', tally.bench, n, TARGETS.bench),
    score('case numbers', tally.cases, n, TARGETS.caseNumbers),
    score('anchor validity', tally.anchorOk, tally.anchorTotal, TARGETS.anchorValidity),
  ];
  const missed = fields
    .filter((f) => f.target !== null && f.rate < f.target)
    .map((f) => `${f.field} below target`);
  const hard =
    tally.hallucinated > 0 ? [`${String(tally.hallucinated)} hallucinated date(s): hard fail`] : [];
  return {
    orders: n,
    adversarial: orders.filter((o) => o.adversarial).length,
    fields,
    hallucinatedDates: tally.hallucinated,
    failures: [...hard, ...missed, ...failures],
    passed: hard.length === 0 && missed.length === 0,
  };
}

/** The deterministic-only run over lawyer-supplied orders (#119): safety counts, no accuracy. */
export async function runPrivateEval(
  dir: string,
): Promise<{ orders: number; hallucinatedDates: number; anchorsInvalid: number }> {
  let hallucinated = 0;
  let invalid = 0;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.txt'))
    .sort();
  for (const file of files) {
    const pages: PageText[] = readFileSync(path.join(dir, file), 'utf8')
      .split('\f')
      .map((text, i) => ({ pageNo: i + 1, text, textSource: 'layer' as const }));
    const { extraction: e } = await extractOrder({
      documentId: DOCUMENT_ID,
      pipelineVersion: 'eval',
      pages,
      ai: null,
    });
    hallucinated += hallucinatedDates(e);
    const a = anchorsValid(e, pages);
    invalid += a.total - a.ok;
  }
  return { orders: files.length, hallucinatedDates: hallucinated, anchorsInvalid: invalid };
}

export function formatReport(report: EvalReport): string {
  const rows = report.fields.map(
    (f) =>
      `${f.field.padEnd(20)} ${String(f.correct).padStart(5)}/${String(f.total).padEnd(5)} ${(f.rate * 100).toFixed(1).padStart(6)}%  target ${f.target === null ? '-' : `${(f.target * 100).toFixed(0)}%`}`,
  );
  return [
    `Order extraction eval: ${String(report.orders)} synthetic orders (${String(report.adversarial)} adversarial), recorded provider`,
    ...rows,
    `${'hallucinated dates'.padEnd(20)} ${String(report.hallucinatedDates)} (must be 0)`,
    report.passed ? 'PASS' : `FAIL\n${report.failures.slice(0, 20).join('\n')}`,
  ].join('\n');
}
