// Court-day reminder schemas (#64): the member's reminder preferences (per kind: on or off, the
// time or delay, and the in-app / push / email channels) and the payload of the reminder jobs.
// Objects are strict. A preference never names a user: the actor is the signed-in member. No `any`.
import { z } from 'zod';

export const REMINDER_KINDS = ['evening', 'morning', 'outcome_missing'] as const;
export const REMINDER_CHANNELS = ['in_app', 'push', 'email'] as const;

/** The evening brief goes out on :00 or :30 from 18:00 to 23:00 (the freeze-safe window). */
const EVENING_TIME = /^(?:(?:18|19|20|21|22):(?:00|30)|23:00)$/;

export const DEFAULT_EVENING_TIME = '20:00';
export const MORNING_TIME = '07:00';
export const DEFAULT_OUTCOME_DELAY_MINUTES = 90;

export const ReminderChannels = z.strictObject({
  in_app: z.boolean(),
  push: z.boolean(),
  email: z.boolean(),
});

export const ReminderPrefs = z.strictObject({
  evening: z.strictObject({
    enabled: z.boolean(),
    time: z.string().regex(EVENING_TIME, 'time must be HH:00 or HH:30 between 18:00 and 23:00'),
    channels: ReminderChannels,
  }),
  morning: z.strictObject({
    enabled: z.boolean(),
    /** Fixed: the morning job runs at 07:00. */
    time: z.literal(MORNING_TIME),
    channels: ReminderChannels,
  }),
  outcome_missing: z.strictObject({
    enabled: z.boolean(),
    delayMinutes: z.int().min(15).max(360),
    channels: ReminderChannels,
  }),
});

/** The payload of `reminder.evening`, `reminder.morning` and `reminder.outcome_missing`. */
export const ReminderPayload = z.strictObject({
  workspaceId: z.uuid(),
  memberId: z.uuid(),
  /** The local day the reminder is for, `YYYY-MM-DD` (tomorrow for the evening brief). */
  date: z.iso.date(),
});

export type ReminderKindValue = (typeof REMINDER_KINDS)[number];
export type ReminderChannelValue = (typeof REMINDER_CHANNELS)[number];
export type ReminderChannels = z.output<typeof ReminderChannels>;
export type ReminderPrefs = z.output<typeof ReminderPrefs>;
export type ReminderPayload = z.output<typeof ReminderPayload>;
