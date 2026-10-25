// `parse_list_a0` and `parse_order_a0` (#56): level 2 by default, versioned prompts, bedrock-served,
// and an output contract in which every row and field carries its page and verbatim quote, so the
// code in `@causedeck/adapters` can verify it. The committed mock fixtures answer the synthetic corpus.
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BEDROCK_TASKS } from '../../providers/bedrock.ts';
import { DEFAULT_FIXTURES_DIR } from '../../providers/mock.ts';
import { getTask } from '../registry.ts';

const anchor = { page: 1, quote: '1. O.S. No. 12/2025    A vs B', lineRef: 1 };

describe('parse_list_a0', () => {
  const task = getTask('parse_list_a0');

  it('is level 2 with a versioned prompt and served by bedrock', () => {
    expect(task.defaultLevel).toBe(2);
    expect(task.promptId).toBe('parse_list_a0.v2');
    expect(BEDROCK_TASKS).toContain('parse_list_a0');
  });

  it('accepts anchored rows and refuses a row without a page or quote', () => {
    const row = {
      ...anchor,
      caseNumber: 'O.S. No. 12/2025',
      cnr: null,
      serial: '1',
      parties: null,
      stageText: null,
      hall: null,
      dates: [],
    };
    expect(task.output.safeParse({ listDate: null, rows: [row], confidence: 0.8 }).success).toBe(
      true,
    );
    const noPage = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'page'));
    expect(task.output.safeParse({ listDate: null, rows: [noPage], confidence: 0.8 }).success).toBe(
      false,
    );
    expect(
      task.output.safeParse({ listDate: null, rows: [{ ...row, quote: '' }], confidence: 0.8 })
        .success,
    ).toBe(false);
    expect(
      task.output.safeParse({
        listDate: null,
        rows: [{ ...row, dates: ['12 Nov'] }],
        confidence: 0.8,
      }).success,
    ).toBe(false);
  });
});

describe('parse_order_a0', () => {
  const task = getTask('parse_order_a0');

  it('is registered at level 2 with a versioned prompt and served by bedrock', () => {
    expect(task.defaultLevel).toBe(2);
    expect(task.promptId).toBe('parse_order_a0.v1');
    expect(BEDROCK_TASKS).toContain('parse_order_a0');
  });

  it('every field of the output carries a page and a quote', () => {
    const output = {
      caseNumbers: [{ ...anchor, value: 'O.S. No. 12/2025' }],
      cnrs: [],
      parties: [],
      orderDate: { ...anchor, date: '2026-11-12' },
      orderType: 'interim',
      directions: [],
      nextDate: { ...anchor, date: null, phrase: 'List after four weeks' },
      confidence: 0.7,
    };
    expect(task.output.safeParse(output).success).toBe(true);
    expect(task.output.safeParse({ ...output, orderDate: { date: '2026-11-12' } }).success).toBe(
      false,
    );
  });
});

describe('mock fixtures', () => {
  it('commits recorded outputs for the synthetic A0 documents', () => {
    for (const id of ['parse_list_a0', 'parse_order_a0']) {
      expect(
        readdirSync(path.join(DEFAULT_FIXTURES_DIR, id)).filter((f) => f.endsWith('.json')).length,
      ).toBeGreaterThan(0);
    }
  });
});
