// A direction's compliance deadline (#494, D-048): "comply within 10 days" of an order, counted on
// the forum's court calendar. Only a "within" period is a deadline the court's closure moves; an
// "after N weeks" phrase is a listing date the court itself names, so it is left as extracted.
import type { Database, Transaction } from '@causedeck/db';
import { addInterval, findRelativePhrases } from '@causedeck/intelligence';

import { loadCourtCalendar, type VacationRange } from './calendar.ts';
import { computeDueDate, type DueDate } from './compute.ts';

/** How far past the raw end of a period the calendar is loaded (covers a vacation roll). */
const CALENDAR_WINDOW_DAYS = 120;

export interface DirectionDeadlineInput {
  workspaceId: string;
  forumCode: string;
  /** The order's date (ISO). */
  orderDate: string;
  /** The direction's due expression or anchored quote. */
  expression: string;
  vacations?: readonly VacationRange[];
}

/** The calendar-aware due date of a "within N days|weeks|months" direction, or null when it is not one. */
export async function deadlineForDirection(
  db: Database | Transaction,
  input: DirectionDeadlineInput,
): Promise<DueDate | null> {
  const phrase = findRelativePhrases(input.expression).find((p) => p.preposition === 'within');
  if (phrase === undefined) return null;
  const raw = addInterval(input.orderDate, phrase.n, phrase.unit);
  const calendar = await loadCourtCalendar(db, input.workspaceId, {
    forumCode: input.forumCode,
    from: raw,
    to: addInterval(raw, CALENDAR_WINDOW_DAYS, 'day'),
    ...(input.vacations === undefined ? {} : { vacations: input.vacations }),
  });
  return computeDueDate({ from: input.orderDate, n: phrase.n, unit: phrase.unit, calendar });
}

/** The minimal shape of an extracted direction the rule pass reads and rewrites. */
export interface RuleDirection {
  dueExpression?: string | undefined;
  dueDate?: string | undefined;
  anchor: { quote: string };
  derived?: boolean | undefined;
}

/**
 * Re-derive each dated "within" direction on the forum's calendar: its `dueDate` rolls to the next
 * working day and its `dueExpression` (which becomes the obligation's `basis`) carries the rule in
 * words. A direction with no such phrase, or no order date, is returned as extracted.
 */
export async function applyDeadlineRules<D extends RuleDirection>(
  db: Database | Transaction,
  input: { workspaceId: string; forumCode: string; orderDate: string | undefined; directions: D[] },
): Promise<D[]> {
  const { orderDate } = input;
  if (orderDate === undefined) return input.directions;
  const out: D[] = [];
  for (const d of input.directions) {
    if (d.dueDate === undefined || d.derived !== true) {
      out.push(d);
      continue;
    }
    const expression = d.dueExpression ?? d.anchor.quote;
    const due = await deadlineForDirection(db, {
      workspaceId: input.workspaceId,
      forumCode: input.forumCode,
      orderDate,
      expression,
    });
    out.push(
      due === null
        ? d
        : { ...d, dueDate: due.date, dueExpression: `${expression}: ${due.rule}`.slice(0, 500) },
    );
  }
  return out;
}
