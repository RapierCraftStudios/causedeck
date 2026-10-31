// Record that a user reached a funnel step (#509). Ids and closed enums only: the row holds the
// user id, the step, an optional acquisition channel, a timestamp and, for the onboarding steps,
// integer counts of matters discovered and confirmed (#699), never a matter, an email or any free
// text. A step counts once per user (`activation_event_user_step_uq`).
import { schema, type Queryable } from '@causedeck/db';

export const ACTIVATION_CHANNELS = schema.ACTIVATION_CHANNELS;
export const ACTIVATION_STEPS = schema.ACTIVATION_STEPS;
export type ActivationChannel = schema.ActivationChannel;
export type ActivationStep = schema.ActivationStep;

export interface RecordActivationInput {
  userId: string;
  step: ActivationStep;
  /** How the user arrived; set it on `signed_up`, which anchors the cohort. */
  channel?: ActivationChannel;
  /** Matters discovered (#699). Written on the first insert only; ignored when not a count. */
  discovered?: number;
  /** Matters confirmed into the workspace (#699). Written on the first insert only. */
  confirmed?: number;
  at?: Date;
}

/** A usable count: a non-negative integer, else null (the column's check would reject the row). */
function count(value: number | undefined): number | null {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Insert the user's first occurrence of `step`; a repeat does nothing. Returns whether a row was
 * written. Never throws: measurement must not fail the action it observes, so a failure is
 * reported through `onError` (default: ignored) and returns false.
 */
export async function recordActivation(
  db: Queryable,
  { userId, step, channel, discovered, confirmed, at }: RecordActivationInput,
  onError?: (error: unknown) => void,
): Promise<boolean> {
  try {
    const rows = await db
      .insert(schema.activationEvent)
      .values({
        userId,
        step,
        channel: channel ?? null,
        mattersDiscovered: count(discovered),
        mattersConfirmed: count(confirmed),
        ...(at === undefined ? {} : { occurredAt: at }),
      })
      .onConflictDoNothing({ target: [schema.activationEvent.userId, schema.activationEvent.step] })
      .returning({ id: schema.activationEvent.id });
    return rows.length > 0;
  } catch (error) {
    onError?.(error);
    return false;
  }
}
