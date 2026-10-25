import type { Queryable } from '@causedeck/db';
import type { FinishedOutcome } from '@causedeck/intelligence';
import { describe, expect, it, vi } from 'vitest';

import { diaryStepApplies, runDiaryStep } from '../diary.ts';
import type { CaptureRecord } from '../state.ts';

const finished: FinishedOutcome = {
  status: 'ready',
  reason: null,
  documentId: '11111111-1111-4111-8111-111111111111',
  kind: 'note',
  language: 'en',
  textStatus: 'ocr',
  lowConfidencePages: [],
  skippedReason: null,
  created: true,
  route: null,
};
const camera = { channel: 'camera', aiBlocked: false } as CaptureRecord;

describe('diary step', () => {
  it('applies to a fresh camera document and nothing else', () => {
    expect(diaryStepApplies(camera, finished)).toBe(true);
    expect(diaryStepApplies({ ...camera, channel: 'upload' }, finished)).toBe(false);
    expect(diaryStepApplies(camera, { ...finished, route: 'cause_list' })).toBe(false);
    expect(diaryStepApplies(camera, { ...finished, created: false })).toBe(false);
  });

  it('touches neither the database nor the gateway for a sensitive-matter capture', async () => {
    const run = vi.fn();
    const select = vi.fn();
    const result = await runDiaryStep(
      { select } as unknown as Queryable,
      { ...camera, aiBlocked: true },
      finished,
      { gateway: { run } as never, now: new Date(0), pipelineVersion: 'v1' },
    );
    expect(result.summary).toEqual({ status: 'skipped', entries: 0, proposals: 0 });
    expect(result.outcome).toBe(finished);
    expect(run).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
});
