// The automation ladder (#47, ADR 0021; docs/product/09 §4.1). L1 observes and suggests, L2
// proposes and changes nothing until a person accepts, L3 applies an internal, reversible change
// and logs it with a 7-day undo, L4 prepares an outward draft that a lawyer must send. The ladder
// stops at L4: the type, the database CHECK and `scripts/check-no-l5.ts` all hold it there (PRD TR-1).
import { schema } from '@causedeck/db';

/** The ladder, lowest to highest. The database CHECKs on `proposal` and `activity` list the same. */
export const AUTOMATION_LEVELS = schema.AUTOMATION_LEVELS;

export type AutomationLevel = (typeof AUTOMATION_LEVELS)[number];

export function isAutomationLevel(value: unknown): value is AutomationLevel {
  return typeof value === 'string' && (AUTOMATION_LEVELS as readonly string[]).includes(value);
}

/** The numeric level `ai_call.automation_level` stores (1..4). */
export function toNumericLevel(level: AutomationLevel): 1 | 2 | 3 | 4 {
  return (AUTOMATION_LEVELS.indexOf(level) + 1) as 1 | 2 | 3 | 4;
}

export function fromNumericLevel(level: number): AutomationLevel {
  const found = AUTOMATION_LEVELS[level - 1];
  if (!Number.isInteger(level) || found === undefined) {
    throw new RangeError(`automation level must be 1-4, got ${String(level)}`);
  }
  return found;
}

/** Days an auto-applied action stays undoable. */
export const UNDO_WINDOW_DAYS = 7;
export const UNDO_WINDOW_MS = UNDO_WINDOW_DAYS * 24 * 60 * 60 * 1000;
