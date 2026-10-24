import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CalendarModule from './calendar.ts';

const cal = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('./calendar.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof CalendarModule>()),
  loadCourtCalendar: cal.load,
}));

const { applyDeadlineRules, deadlineForDirection } = await import('./direction.ts');

const db = {} as never;
const base = { workspaceId: 'ws-1', forumCode: 'in.tn.madras-hc.chennai', orderDate: '2026-10-22' };

beforeEach(() => {
  cal.load.mockReset();
  cal.load.mockResolvedValue({
    forumCode: base.forumCode,
    weeklyOffs: [0],
    holidays: new Map([['2026-11-19', 'Holiday']]),
    vacations: [],
  });
});

describe('deadlineForDirection', () => {
  it('rolls a "within" period past a closed day and states the rule', async () => {
    const due = await deadlineForDirection(db, { ...base, expression: 'within four weeks' });
    expect(due?.date).toBe('2026-11-20');
    expect(due?.rule).toBe('4 weeks from 22 Oct; court closed 19 Nov, so 20 Nov');
  });

  it('leaves an "after" listing phrase to the extraction', async () => {
    expect(await deadlineForDirection(db, { ...base, expression: 'after four weeks' })).toBeNull();
    expect(cal.load).not.toHaveBeenCalled();
  });
});

describe('applyDeadlineRules', () => {
  const direction = (over: Record<string, unknown> = {}) => ({
    dueExpression: 'within four weeks',
    dueDate: '2026-11-19',
    derived: true,
    anchor: { quote: 'file counter within four weeks' },
    ...over,
  });

  it('rewrites the due date and carries the rule in the expression', async () => {
    const [out] = await applyDeadlineRules(db, { ...base, directions: [direction()] });
    expect(out?.dueDate).toBe('2026-11-20');
    expect(out?.dueExpression).toBe(
      'within four weeks: 4 weeks from 22 Oct; court closed 19 Nov, so 20 Nov',
    );
  });

  it('keeps a direction as extracted without an order date, a due date or a "within" phrase', async () => {
    const plain = direction({ dueExpression: 'after two weeks' });
    const undated = direction({ dueDate: undefined });
    const out = await applyDeadlineRules(db, { ...base, directions: [plain, undated] });
    expect(out).toEqual([plain, undated]);
    const noOrder = direction();
    expect(
      await applyDeadlineRules(db, { ...base, orderDate: undefined, directions: [noOrder] }),
    ).toEqual([noOrder]);
  });
});
