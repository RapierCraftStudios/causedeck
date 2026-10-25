// Golden metrics for the Madras HC adapter on seeded synthetic data (#401, part 4 of #36; ADR
// 0018). Seed 7 builds at least 30 lists and 50 orders (plus AIMS emails and registry notices); the
// adapter parses each and is scored against the generator's truth. A parsed row counts only when
// every `SCORED_ROW_FIELDS` field equals a truth row. Gates: row precision >= 99.5%, recall >= 95%,
// order-date accuracy >= 98% and zero invented dates (every date the adapter emits is printed in
// the document or derived from a printed date). Runs in CI as `test:metrics`, after `gen:fixtures`.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { layoutFromEmail } from '../layout/email.ts';
import { layoutFromPdf } from '../layout/pdf.ts';
import { GOLDEN_RECEIVED_AT, SCORED_ROW_FIELDS } from '../testing/golden.ts';
import type { ParsedCauseList, ParserInput } from '../types.ts';

import { createMadrasHcAdapter, parseRegistryEvents } from './index.ts';
import {
  generateMadrasFixtures,
  inputFileOf,
  writeGeneratedFixtures,
  type GeneratedDocument,
  type MadrasTruthRow,
} from './synthetic/generate.ts';

const SEED = 7;
const adapter = createMadrasHcAdapter();
const forumCode = adapter.forumCodes[0] ?? '';

async function inputOf(doc: GeneratedDocument): Promise<ParserInput> {
  const meta = { fileName: inputFileOf(doc), receivedAt: GOLDEN_RECEIVED_AT, forumCode };
  if (doc.format === 'pdf') {
    return { kind: 'layout', layout: await layoutFromPdf(doc.content as Uint8Array), meta };
  }
  const text = doc.content as string;
  if (doc.format === 'eml') return { kind: 'email', text, layout: layoutFromEmail(text), meta };
  return { kind: 'text', text, meta };
}

const rowKey = (row: Partial<Record<keyof MadrasTruthRow, unknown>>): string =>
  JSON.stringify(SCORED_ROW_FIELDS.map((field) => row[field] ?? null));

interface Metrics {
  lists: number;
  orders: number;
  parsedRows: number;
  truthRows: number;
  correctRows: number;
  ordersDated: number;
  invented: string[];
  mismatches: string[];
}

function scoreList(doc: GeneratedDocument, parsed: ParsedCauseList, into: Metrics): void {
  const truth = doc.truth.rows ?? [];
  const remaining = new Map<string, number>();
  for (const row of truth) remaining.set(rowKey(row), (remaining.get(rowKey(row)) ?? 0) + 1);
  into.parsedRows += parsed.rows.length;
  into.truthRows += truth.length;
  for (const row of parsed.rows) {
    const key = rowKey(row);
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      into.correctRows += 1;
    } else {
      into.mismatches.push(`${doc.name}: got ${key}`);
    }
  }
  for (const [key, left] of remaining) {
    if (left > 0) into.mismatches.push(`${doc.name}: missing ${key}`);
  }
  if (parsed.listDate !== null && !doc.truth.dates.includes(parsed.listDate)) {
    into.invented.push(`${doc.name}: listDate ${parsed.listDate}`);
  }
}

async function measure(seed: number): Promise<Metrics> {
  const { documents } = await generateMadrasFixtures({ seed });
  const metrics: Metrics = {
    lists: 0,
    orders: 0,
    parsedRows: 0,
    truthRows: 0,
    correctRows: 0,
    ordersDated: 0,
    invented: [],
    mismatches: [],
  };
  for (const doc of documents) {
    const input = await inputOf(doc);
    const emitted: (string | null | undefined)[] = [];
    if (doc.kind === 'cause_list') {
      if (doc.format !== 'eml') metrics.lists += 1;
      scoreList(doc, await adapter.parseCauseList(input), metrics);
    } else if (doc.kind === 'order') {
      metrics.orders += 1;
      const header = adapter.parseOrderHeader(input);
      if (header.orderDate === doc.truth.orderDate) metrics.ordersDated += 1;
      else metrics.mismatches.push(`${doc.name}: orderDate ${String(header.orderDate)}`);
      emitted.push(header.orderDate, ...adapter.findDirectionCues(input).map((cue) => cue.date));
    } else {
      for (const event of parseRegistryEvents(input)) {
        emitted.push(event.deadline?.basisDate, event.deadline?.derived);
      }
    }
    for (const date of emitted) {
      if (date != null && !doc.truth.dates.includes(date)) {
        metrics.invented.push(`${doc.name}: ${date}`);
      }
    }
  }
  return metrics;
}

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('Madras HC golden metrics on generated data (#401)', () => {
  it('meets the precision, recall, order-date and invented-date gates for seed 7', async () => {
    const m = await measure(SEED);
    const precision = m.correctRows / m.parsedRows;
    const recall = m.correctRows / m.truthRows;
    const orderDateAccuracy = m.ordersDated / m.orders;
    console.info(
      [
        `lists ${String(m.lists)}, orders ${String(m.orders)}, rows parsed ${String(m.parsedRows)} / truth ${String(m.truthRows)}`,
        `row precision ${precision.toFixed(4)}, recall ${recall.toFixed(4)}, order-date accuracy ${orderDateAccuracy.toFixed(4)}, invented dates ${String(m.invented.length)}`,
        ...m.mismatches.slice(0, 40),
        ...m.invented.slice(0, 10),
      ].join('\n'),
    );
    expect(m.lists).toBeGreaterThanOrEqual(30);
    expect(m.orders).toBeGreaterThanOrEqual(50);
    expect(precision).toBeGreaterThanOrEqual(0.995);
    expect(recall).toBeGreaterThanOrEqual(0.95);
    expect(orderDateAccuracy).toBeGreaterThanOrEqual(0.98);
    expect(m.invented).toEqual([]);
  });

  it('is deterministic per seed, differs across seeds and is FICTIONAL throughout', async () => {
    const first = await generateMadrasFixtures({ seed: SEED });
    const again = await generateMadrasFixtures({ seed: SEED });
    expect(again).toEqual(first);
    const other = await generateMadrasFixtures({ seed: SEED + 1 });
    expect(other.documents.map((doc) => doc.content)).not.toEqual(
      first.documents.map((doc) => doc.content),
    );
    expect(first.documents.filter((doc) => doc.format === 'pdf').length).toBeGreaterThan(0);
    for (const doc of first.documents) {
      if (typeof doc.content === 'string') expect(doc.content, doc.name).toContain('FICTIONAL');
    }
  });

  it('writes byte-identical files for the same seed', async () => {
    const read = (dir: string) =>
      readdirSync(dir)
        .sort()
        .map((name) => [name, readFileSync(path.join(dir, name)).toString('base64')]);
    const dirs = [0, 1].map(() => mkdtempSync(path.join(tmpdir(), 'madras-gen-')));
    tempDirs.push(...dirs);
    const counts = await writeGeneratedFixtures({ seed: SEED, outDir: dirs[0] ?? '' });
    await writeGeneratedFixtures({ seed: SEED, outDir: dirs[1] ?? '' });
    expect(counts.order).toBeGreaterThanOrEqual(50);
    expect(counts.cause_list - counts.emails).toBeGreaterThanOrEqual(30);
    const files = read(dirs[0] ?? '');
    expect(files.length).toBeGreaterThan(2 * (counts.cause_list + counts.order));
    expect(read(dirs[1] ?? '')).toEqual(files);
  });
});
