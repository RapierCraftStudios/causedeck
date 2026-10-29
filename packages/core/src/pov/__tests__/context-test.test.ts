// The context test (#86): owner only, the chosen matter, five standard questions, elapsed time.
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { failure } from '../../__tests__/fixtures.ts';
import {
  answerQuestion,
  finishContextTest,
  listPov,
  startContextTest,
  STANDARD_QUESTIONS,
} from '../index.ts';

import { NOW, povWorld } from './helpers.ts';

describe('context test', () => {
  it('runs five questions, stores the elapsed time and self-marks', async () => {
    await withTestDb(async (tx) => {
      const w = await povWorld(tx);
      let at = NOW;
      const deps = { db: tx, now: () => at };
      expect(STANDARD_QUESTIONS).toHaveLength(5);
      const { runId } = await startContextTest(deps, w.owner, { matterId: w.matterId });
      const early = (await failure(finishContextTest(deps, w.owner, { runId }))) as {
        code: string;
      };
      expect(early.code).toBe('VALIDATION');
      for (const [i, question] of STANDARD_QUESTIONS.entries())
        await answerQuestion(deps, w.owner, { runId, question, correct: i !== 2, atMs: i * 1000 });
      at = new Date(NOW.getTime() + 95_000);
      expect(await finishContextTest(deps, w.owner, { runId })).toEqual({
        elapsedMs: 95_000,
        correct: 4,
      });
      expect((await listPov(deps, w.owner)).contextTests[0]?.elapsedMs).toBe(95_000);
      const again = (await failure(finishContextTest(deps, w.owner, { runId }))) as {
        code: string;
      };
      expect(again.code).toBe('CONFLICT');
    });
  });

  it('is for the owner only', async () => {
    await withTestDb(async (tx) => {
      const w = await povWorld(tx);
      const error = (await failure(
        startContextTest({ db: tx }, w.advocate, { matterId: w.matterId }),
      )) as { code: string };
      expect(error.code).toBe('FORBIDDEN');
    });
  });
});
