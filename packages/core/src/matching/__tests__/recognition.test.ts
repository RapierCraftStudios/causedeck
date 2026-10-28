// Recognition-based matching (#74): R5 alias is a hint only, R6 correction then confirm, R7 the
// correction rate falls, R8 paused aliases unused, R9 no memory keyed to a judge or bench.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { schema } from '@causedeck/db';
import { inWorkspace } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  confirmMemory,
  correctionRate,
  createMemoryNote,
  setMemoryPauseAll,
} from '../../memory/index.ts';
import { inWorld } from '../../__tests__/memory-world.ts';
import {
  learnFromCorrection,
  needsConfirmation,
  rankCandidates,
  rankWithMemory,
  recognitionHints,
  type MatchCandidate,
  type RecognitionHint,
} from '../index.ts';

const rajanA: MatchCandidate = {
  id: 'a',
  caseNumber: 'WP 1/2026',
  names: ['M. Rajan s/o Murugan'],
  score: 0.5,
};
const rajanB: MatchCandidate = {
  id: 'b',
  caseNumber: 'WP 2/2026',
  names: ['R. Rajan s/o Kumar'],
  score: 0.5,
};
const hint: RecognitionHint = {
  alias: 'Rajan',
  canonical: 'M. Rajan s/o Murugan',
  target: 'party',
};

describe('R5: an alias ranks, it never auto-applies', () => {
  it('without a hint two equal candidates need confirmation', () => {
    const ranked = rankCandidates({ text: 'Rajan' }, [rajanA, rajanB], []);
    expect(needsConfirmation(ranked)).toBe(true);
  });

  it('an alias match with no exact case number is an L2 proposal', () => {
    const ranked = rankCandidates({ text: 'Rajan' }, [rajanA, rajanB], [hint]);
    expect(ranked[0]?.id).toBe('a');
    expect(ranked[0]?.level).toBe('L2');
    expect(ranked[0]?.autoApplyAllowed).toBe(false);
    expect(ranked.every((c) => !c.autoApplyAllowed)).toBe(true);
    expect(needsConfirmation(ranked)).toBe(false);
  });

  it('an exact case number or CNR is the only way to L3', () => {
    const byNumber = rankCandidates(
      { caseNumber: 'wp 2 / 2026', text: 'Rajan' },
      [rajanA, rajanB],
      [hint],
    );
    const exact = byNumber.find((c) => c.id === 'b');
    expect(exact?.level).toBe('L3');
    expect(exact?.autoApplyAllowed).toBe(true);
    expect(byNumber.find((c) => c.id === 'a')?.level).toBe('L2');
    const byCnr = rankCandidates(
      { cnr: 'TNCH01-000123-2026' },
      [{ ...rajanA, cnr: 'TNCH01-000123-2026' }],
      [],
    );
    expect(byCnr[0]?.autoApplyAllowed).toBe(true);
  });
});

describe('R6: a correction is learned once confirmed', () => {
  it('files a proposal, saves nothing, and after confirm the same input needs no confirmation', async () => {
    await inWorld(async (w) => {
      const input = { text: 'Rajan' };
      expect(
        needsConfirmation(
          rankCandidates(input, [rajanA, rajanB], await recognitionHints(w.deps, w.owner)),
        ),
      ).toBe(true);
      const proposal = await learnFromCorrection(w.deps, w.owner, {
        alias: 'Rajan',
        canonical: 'M. Rajan s/o Murugan',
      });
      expect(proposal?.status).toBe('proposed');
      expect(await recognitionHints(w.deps, w.owner)).toHaveLength(0);
      await confirmMemory(w.deps, w.owner, proposal?.id ?? '');
      const ranked = await rankWithMemory(w.deps, w.owner, input, [rajanA, rajanB], 'replay-1');
      expect(ranked[0]?.id).toBe('a');
      expect(needsConfirmation(ranked)).toBe(false);
      const usage = await inWorkspace(w.tx, w.a.id, (s) =>
        s.select().from(schema.memoryUsage).where(eq(schema.memoryUsage.usedIn, 'matching')),
      );
      expect(usage).toHaveLength(1);
    });
  });
});

describe('R7: replay benchmark', () => {
  it('the week 4 correction rate is below week 1 after confirmed aliases', () => {
    const cases = [
      { input: 'Rajan', want: 'a', hint },
      {
        input: 'Kumar',
        want: 'b',
        hint: { alias: 'Kumar', canonical: 'R. Rajan s/o Kumar', target: 'party' as const },
      },
    ];
    const week = (hints: RecognitionHint[]) => {
      let corrected = 0;
      let matched = 0;
      for (const c of cases) {
        for (let i = 0; i < 10; i++) {
          const ranked = rankCandidates({ text: c.input }, [rajanA, rajanB], hints);
          if (needsConfirmation(ranked) || ranked[0]?.id !== c.want) corrected++;
          else matched++;
        }
      }
      return correctionRate(corrected, matched);
    };
    const week1 = week([]);
    const week4 = week(cases.map((c) => c.hint));
    expect(week1).toBe(1);
    expect(week4).toBe(0);
    expect((week1 ?? 0) - (week4 ?? 0)).toBeGreaterThan(0.5);
  });
});

describe('R8: paused memory is not used', () => {
  it('pause-all gives no hints', async () => {
    await inWorld(async (w) => {
      await createMemoryNote(w.deps, w.owner, {
        key: 'M7.party_alias',
        value: { alias: 'Rajan', canonical: 'M. Rajan s/o Murugan' },
        scope: 'user',
      });
      expect(await recognitionHints(w.deps, w.owner)).toHaveLength(1);
      await setMemoryPauseAll(w.deps, w.owner, true);
      expect(await recognitionHints(w.deps, w.owner)).toHaveLength(0);
    });
  });
});

describe('R9: no memory keyed to a judge or a bench', () => {
  it('the wiring reads only the lawyer-keyed layers', () => {
    const files = [
      '../recognition.ts',
      '../../briefs/memory-provider.ts',
      '../../outward/compose.ts',
    ];
    for (const f of files) {
      const text = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
      const keys = text.match(/'M\d\.[a-z_]+'/g) ?? [];
      for (const k of keys) expect(k).not.toMatch(/judge|bench/);
      expect(text).not.toMatch(/judge_|bench_|byJudge|forJudge/i);
    }
  });
});
