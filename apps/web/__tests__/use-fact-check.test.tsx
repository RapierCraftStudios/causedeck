// @vitest-environment jsdom
// The live fact-check hook (#916): 600 ms debounce, only changed blocks re-sent, stale answers dropped.
import { act, cleanup, renderHook } from '@testing-library/react';
import type { LiveFactVerdict } from '@causedeck/core/drafting';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

const { changedBlocks, fixText, useFactCheck } = await import('../lib/drafting/use-fact-check.ts');

const verdict = (blockKey: string): LiveFactVerdict => ({
  claimId: `c-${blockKey}`,
  claimKey: `k-${blockKey}`,
  kind: 'date',
  status: 'mismatch',
  resolution: 'open',
  anchor: { document: 'order:1', page: 1, quote: 'q' },
  blockKey,
  start: 0,
  end: 2,
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useFactCheck', () => {
  it('waits 600 ms, then re-sends only the changed block', async () => {
    const run = vi.fn((blocks: { key: string }[]) =>
      Promise.resolve({
        verdicts: blocks.map((b) => verdict(b.key)),
        deep: false,
      }),
    );
    const { result, rerender } = renderHook(
      ({ blocks }) => useFactCheck({ matterId: 'm', blocks, run }),
      {
        initialProps: {
          blocks: [
            { key: 'a', text: 'one' },
            { key: 'b', text: 'two' },
          ],
        },
      },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(599);
    });
    expect(run).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.count).toBe(2);
    rerender({
      blocks: [
        { key: 'a', text: 'one' },
        { key: 'b', text: 'two!' },
      ],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]).toEqual([{ key: 'b', text: 'two!' }]);
  });

  it('checks nothing without a matter', async () => {
    const run = vi.fn();
    renderHook(() => useFactCheck({ matterId: null, blocks: [{ key: 'a', text: 'x' }], run }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('changedBlocks lists new and edited blocks', () => {
    const checked = new Map([['a', { text: 'x' }]]);
    expect(
      changedBlocks(checked, [
        { key: 'a', text: 'x' },
        { key: 'b', text: 'y' },
      ]),
    ).toEqual([{ key: 'b', text: 'y' }]);
  });
  it('offers a fix only for a case number or CNR mismatch against a proceeding', () => {
    const v: LiveFactVerdict = {
      ...verdict('a'),
      kind: 'case_number',
      anchor: { document: 'proceeding:1', page: 1, quote: 'Q' },
    };
    expect(fixText(v)).toBe('Q');
    expect(fixText({ ...v, kind: 'date' })).toBeNull();
  });
});
