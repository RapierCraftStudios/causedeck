import type { AiGateway } from '@causedeck/ai';
import { describe, expect, it, vi } from 'vitest';

import { datePresence } from './dates.ts';
import { loadDiaryFixtures, modelAnswer, must, type DiaryFixture } from './fixtures.ts';
import { numberLines, type DiaryPage } from './line-anchors.ts';
import { DiaryStructuredSchema } from './schema.ts';
import {
  DIARY_UNREADABLE_COPY,
  structureDiaryPage,
  verifyDiaryEntries,
  type RawDiaryEntry,
} from './structure.ts';

function gatewayReturning(entries: () => RawDiaryEntry[]) {
  const run = vi.fn(() =>
    Promise.resolve({ output: { entries: entries(), confidence: 0.9 }, callId: 'call-1' }),
  );
  return { gateway: { run } as unknown as AiGateway, run };
}

const scope = { workspaceId: 'w1', captureId: 'c1' };
const pageOf = (fixture: DiaryFixture): DiaryPage => ({
  page: 1,
  text: fixture.text,
  confidence: fixture.confidence,
  lines: fixture.lines,
});

describe('structureDiaryPage', () => {
  const [fixture] = loadDiaryFixtures() as [DiaryFixture];

  it('never calls the gateway for a sensitive matter (no ai_call row is written)', async () => {
    const { gateway, run } = gatewayReturning(() => []);
    const outcome = await structureDiaryPage(
      { gateway, scope, pipelineVersion: 'v1' },
      { pages: [pageOf(fixture)], aiBlocked: true },
    );
    expect(outcome).toEqual({ status: 'skipped', reason: 'sensitive_matter' });
    expect(run).not.toHaveBeenCalled();
  });

  it('says unreadable instead of guessing on a low-confidence page or one with no lines', async () => {
    const { gateway, run } = gatewayReturning(() => []);
    const deps = { gateway, scope, pipelineVersion: 'v1' };
    const blurry = {
      ...pageOf(fixture),
      lines: fixture.lines.map((line) => ({ ...line, conf: 0.2 })),
    };
    expect(await structureDiaryPage(deps, { pages: [blurry], aiBlocked: false })).toMatchObject({
      status: 'unreadable',
      reason: 'low_confidence',
      copy: DIARY_UNREADABLE_COPY,
    });
    expect(
      await structureDiaryPage(deps, {
        pages: [{ ...pageOf(fixture), lines: [] }],
        aiBlocked: false,
      }),
    ).toMatchObject({ status: 'unreadable', reason: 'no_lines' });
    expect(run).not.toHaveBeenCalled();
  });

  it('anchors every entry and date to a line box and drops hallucinated dates', () => {
    const lines = numberLines([pageOf(fixture)]);
    const raw: RawDiaryEntry[] = [
      {
        text: 'Hearing note',
        kind: 'hearing_note',
        line: 2,
        nextDate: { date: '2031-01-01', phrase: 'a date nobody wrote', line: 2 },
      },
      { text: 'Cites a line that does not exist', kind: 'task', line: 99 },
    ];
    const verified = verifyDiaryEntries(raw, lines);
    expect(verified.rejected).toBe(1);
    expect(verified.datesRejected).toBe(1);
    expect(verified.entries).toHaveLength(1);
    expect(verified.entries[0]?.nextDate).toBeUndefined();
    expect(verified.entries[0]?.anchor).toEqual({
      page: 1,
      bbox: must(lines[1]).bbox,
      quote: must(lines[1]).text,
    });
  });

  it('rejects a date whose phrase is not on the cited line even if the phrase has the date', () => {
    const lines = numberLines([pageOf(fixture)]);
    const verified = verifyDiaryEntries(
      [
        {
          text: 'x',
          kind: 'hearing_note',
          line: 2,
          nextDate: { date: '2026-10-12', phrase: '12 Oct 2026', line: 1 },
        },
      ],
      lines,
    );
    expect(verified.datesRejected).toBe(1);
  });
});

describe('diary eval on synthetic pages', () => {
  const fixtures = loadDiaryFixtures();

  it('has at least 30 pages per language', () => {
    for (const lang of ['en', 'ta', 'kn']) {
      expect(fixtures.filter((f) => f.lang === lang).length).toBeGreaterThanOrEqual(30);
    }
  });

  it('reads dates at >= 95%, hallucinates none and anchors every entry', async () => {
    let expected = 0;
    let correct = 0;
    for (const fixture of fixtures) {
      // A faithful model, plus one hallucinated date per page that the page does not contain.
      const answer = modelAnswer(fixture);
      answer.push({
        text: must(fixture.lines[0]).text,
        kind: 'reminder',
        line: 1,
        nextDate: { date: '2031-07-07', phrase: must(fixture.lines[0]).text, line: 1 },
      });
      const { gateway } = gatewayReturning(() => answer);
      const outcome = await structureDiaryPage(
        { gateway, scope, pipelineVersion: 'v1' },
        { pages: [pageOf(fixture)], aiBlocked: false },
      );
      if (outcome.status !== 'ok') throw new Error(`${fixture.name}: ${outcome.status}`);
      expect(DiaryStructuredSchema.safeParse(outcome.result).success).toBe(true);
      const lines = numberLines([pageOf(fixture)]);
      for (const entry of outcome.result.entries) {
        expect(
          lines.some(
            (l) => l.text === entry.anchor.quote && l.bbox.join() === entry.anchor.bbox.join(),
          ),
        ).toBe(true);
        if (entry.nextDate !== undefined) {
          expect(datePresence(entry.nextDate.date, entry.nextDate.phrase)).toBe(true);
          expect(entry.nextDate.date).not.toBe('2031-07-07');
        }
      }
      for (const truth of fixture.truth) {
        if (truth.nextDate === null) continue;
        expected += 1;
        const got = outcome.result.entries.find(
          (e) => e.anchor.quote === must(fixture.lines[truth.line - 1]).text,
        );
        if (got?.nextDate?.date === truth.nextDate) correct += 1;
      }
    }
    expect(correct / expected).toBeGreaterThanOrEqual(0.95);
  });

  it('structures a 4-page batch well inside the 25 s p95 budget with the mock provider', async () => {
    const pages = fixtures.slice(0, 4).map((f, i) => ({ ...pageOf(f), page: i + 1 }));
    const { gateway } = gatewayReturning(() => []);
    const started = performance.now();
    await structureDiaryPage(
      { gateway, scope, pipelineVersion: 'v1' },
      { pages, aiBlocked: false },
    );
    expect(performance.now() - started).toBeLessThan(25_000);
  });
});
