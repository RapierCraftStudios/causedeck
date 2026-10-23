// Record that a user reached a funnel step (#509). Ids and closed enums only: the row holds the
// user id, the step, an optional acquisition channel and a timestamp, never a matter, an email or
// any free text. A step counts once per user (`activation_event_user_step_uq`).
import { schema, type ActivationChannel, type ActivationStep, type Queryable } from '@causedeck/db';

export { ACTIVATION_CHANNELS, ACTIVATION_STEPS } from '@causedeck/db';
export type { ActivationChannel, ActivationStep };

export interface RecordActivationInput {
  userId: string;
  step: ActivationStep;
  /** How the user arrived; set it on `signed_up`, which anchors the cohort. */
  channel?: ActivationChannel;
  at?: Date;
}

/**
 * Insert the user's first occurrence of `step`; a repeat does nothing. Returns whether a row was
 * written. Never throws: measurement must not fail the action it observes, so a failure is
 * reported through `onError` (default: ignored) and returns false.
 */
export async function recordActivation(
  db: Queryable,
  { userId, step, channel, at }: RecordActivationInput,
  onError?: (error: unknown) => void,
): Promise<boolean> {
  try {
    const rows = await db
      .insert(schema.activationEvent)
      .values({
        userId,
        step,
        channel: channel ?? null,
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
