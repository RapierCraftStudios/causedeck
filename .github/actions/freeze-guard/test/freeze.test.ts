// Boundary tests for the court-day freeze (#100): `pnpm test:ci-scripts`.
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test runs describe/it itself */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateFreeze } from '../freeze.ts';
import { run } from '../index.ts';

// IST = UTC+05:30 all year (no DST), so 12:34 IST is 07:04 UTC.
const ist = (date: string, time: string): Date => new Date(`${date}T${time}+05:30`);

describe('freeze windows (start inclusive, end exclusive)', () => {
  const cases: [string, string, boolean, string][] = [
    ['06:59:59', 'open before morning court', false, ''],
    ['07:00:00', 'morning court starts', true, 'morning-court'],
    ['10:29:59', 'last frozen second of morning', true, 'morning-court'],
    ['10:30:00', 'morning court ends', false, ''],
    ['12:00:00', 'midday open', false, ''],
    ['17:59:59', 'open before evening', false, ''],
    ['18:00:00', 'evening prepare starts', true, 'evening-prepare'],
    ['22:59:59', 'last frozen second of evening', true, 'evening-prepare'],
    ['23:00:00', 'evening prepare ends', false, ''],
    ['00:00:00', 'midnight open', false, ''],
    ['03:00:00', 'night open', false, ''],
  ];
  for (const [time, label, frozen, name] of cases) {
    it(`${time} IST: ${label}`, () => {
      const result = evaluateFreeze(ist('2026-10-21', time));
      assert.equal(result.frozen, frozen);
      assert.equal(result.windowName, name);
    });
  }

  it('ignores milliseconds at the boundary', () => {
    assert.equal(evaluateFreeze(new Date('2026-10-21T10:29:59.999+05:30')).frozen, true);
    assert.equal(evaluateFreeze(new Date('2026-10-21T10:30:00.000+05:30')).frozen, false);
  });

  it('converts from UTC: 12:30 UTC is 18:00 IST', () => {
    assert.equal(evaluateFreeze(new Date('2026-10-21T12:29:59Z')).frozen, false);
    assert.equal(evaluateFreeze(new Date('2026-10-21T12:30:00Z')).frozen, true);
  });

  it('uses the IST date, not the UTC date, across midnight', () => {
    const late = evaluateFreeze(new Date('2026-10-20T18:29:59Z')); // 23:59:59 IST on the 20th
    assert.equal(late.frozen, false);
    assert.match(late.nextFreezeAtIst, /^2026-10-21 07:00 IST$/);
  });

  it('applies the same windows on every day of the week and across a year end', () => {
    for (let day = 0; day < 8; day++) {
      const date = new Date(Date.UTC(2026, 11, 28 + day)).toISOString().slice(0, 10);
      assert.equal(evaluateFreeze(ist(date, '07:00:00')).frozen, true, date);
      assert.equal(evaluateFreeze(ist(date, '10:30:00')).frozen, false, date);
      assert.equal(evaluateFreeze(ist(date, '18:00:00')).frozen, true, date);
      assert.equal(evaluateFreeze(ist(date, '23:00:00')).frozen, false, date);
    }
  });
});

describe('next open window', () => {
  it('names the end of the morning window', () => {
    assert.equal(
      evaluateFreeze(ist('2026-10-21', '08:15:00')).nextOpenAtIst,
      '2026-10-21 10:30 IST',
    );
  });
  it('names the end of the evening window', () => {
    assert.equal(
      evaluateFreeze(ist('2026-10-21', '18:00:00')).nextOpenAtIst,
      '2026-10-21 23:00 IST',
    );
  });
  it('reports the next freeze start when open', () => {
    const noon = evaluateFreeze(ist('2026-10-21', '12:00:00'));
    assert.equal(noon.nextFreezeAtIst, '2026-10-21 18:00 IST');
    assert.equal(noon.secondsUntilFreeze, 6 * 3600);
    assert.equal(
      evaluateFreeze(ist('2026-10-21', '23:30:00')).nextFreezeAtIst,
      '2026-10-22 07:00 IST',
    );
  });
});

describe('run()', () => {
  it('fails inside a freeze with a message naming the next open window', () => {
    const outcome = run(ist('2026-10-21', '18:30:00'), false);
    assert.equal(outcome.exitCode, 1);
    assert.equal(outcome.outputs.frozen, 'true');
    assert.equal(outcome.outputs.window_name, 'evening-prepare');
    assert.match(outcome.message, /Next open window: 2026-10-21 23:00 IST/);
  });
  it('passes outside a freeze', () => {
    const outcome = run(ist('2026-10-21', '12:00:00'), false);
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.outputs.frozen, 'false');
  });
  it('the hotfix override reports the freeze but does not fail', () => {
    const outcome = run(ist('2026-10-21', '08:00:00'), true);
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.outputs.frozen, 'true');
    assert.match(outcome.message, /bypassed/);
  });
});
