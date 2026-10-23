// The confirm grid's edit model (#551): grouping edits, the derived rows, the sort by next date,
// and the decisions that follow the saved plan.
import { describe, expect, it, vi } from 'vitest';

import {
  confirmImport,
  decisionsFor,
  groupsOf,
  keysetOf,
  mergeGroups,
  moveProceeding,
  previewMatters,
  renameGroup,
  splitProceeding,
} from '../../../lib/import/plan-edit.ts';

import { PLAN } from './fixtures.ts';

const groups = groupsOf(PLAN);

describe('plan edits', () => {
  it('renames, merges, splits and moves without losing a proceeding', () => {
    expect(renameGroup(groups, 'm_late', 'Renamed')[0]?.title).toBe('Renamed');
    const merged = mergeGroups(groups, 'm_late', 'm_early');
    expect(merged.map((g) => g.tempId)).toEqual(['m_late', 'm_conflict']);
    expect(merged[0]?.proceedingKeys).toEqual(['1', '4']);
    const split = splitProceeding(groups, '3', 'Three');
    expect(split.map((g) => g.proceedingKeys)).toEqual([['1'], ['2'], ['3'], ['4']]);
    const moved = moveProceeding(groups, '1', 'm_early');
    expect(moved.map((g) => g.tempId)).toEqual(['m_conflict', 'm_early']);
    expect(moved.flatMap((g) => g.proceedingKeys).sort()).toEqual(['1', '2', '3', '4']);
  });

  it('does not split a matter of one proceeding', () => {
    expect(splitProceeding(groups, '1', 'x')).toBe(groups);
  });
});

describe('previewMatters', () => {
  it('sorts by next date with the undated conflict last and opens its blocking issue', () => {
    const rows = previewMatters(PLAN, groups);
    expect(rows.map((m) => m.tempId)).toEqual(['m_early', 'm_late', 'm_conflict']);
    expect(rows[2]?.open).toHaveLength(1);
  });

  it('a picked date resolves the conflict and becomes the next date', () => {
    const rows = previewMatters(PLAN, groups, { '2': '2026-11-17' });
    const row = rows.find((m) => m.tempId === 'm_conflict');
    expect(row?.open).toEqual([]);
    expect(row?.nextDate?.date).toBe('2026-11-17');
    expect(rows.map((m) => m.tempId)).toEqual(['m_early', 'm_conflict', 'm_late']);
  });
});

describe('confirmImport', () => {
  it('saves a dirty grouping first and maps skipped matters onto the saved plan', async () => {
    const edited = {
      ...PLAN,
      matters: PLAN.matters.map((m) => (m.tempId === 'm_early' ? { ...m, tempId: 'm_saved' } : m)),
    };
    const savePlan = vi.fn(() => Promise.resolve({ ok: true as const, data: edited }));
    const applyPlan = vi.fn(() => Promise.resolve({ ok: true as const, data: 'applied' }));
    const result = await confirmImport(
      { groups, dirty: true, excluded: [keysetOf(['4'])], resolvedDates: { '2': '2026-11-03' } },
      { savePlan, applyPlan, plan: PLAN },
    );
    expect(result).toEqual({ ok: true, data: 'applied' });
    expect(applyPlan).toHaveBeenCalledWith({
      matters: { m_saved: { action: 'skip' } },
      resolvedDates: { '2': '2026-11-03' },
    });
  });

  it('applies nothing when the save fails', async () => {
    const failure = { ok: false as const, error: { code: 'CONFLICT', message: 'x' } };
    const applyPlan = vi.fn();
    const result = await confirmImport(
      { groups, dirty: true, excluded: [], resolvedDates: {} },
      { savePlan: () => Promise.resolve(failure as never), applyPlan, plan: PLAN },
    );
    expect(result.ok).toBe(false);
    expect(applyPlan).not.toHaveBeenCalled();
  });

  it('decisionsFor leaves resolvedDates out when none were picked', () => {
    expect(decisionsFor(PLAN, new Set(), {})).toEqual({ matters: {} });
  });
});
