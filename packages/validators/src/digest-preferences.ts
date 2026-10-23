// The end-of-day digest preference (#49; docs/product/09 §8.6): `digest.end_of_day {enabled, time,
// includeNames}`. `time` is the member's local send time, on the half hour between 18:00 and 23:00
// (the scheduler fires every 30 minutes and nothing goes out during a deploy freeze window).
// `includeNames` is off by default: the digest carries counts only unless the member opts in.
import { z } from 'zod';

/** Earliest and latest local send time, as minutes after midnight. */
export const END_OF_DAY_FIRST_MINUTE = 18 * 60;
export const END_OF_DAY_LAST_MINUTE = 23 * 60;
export const DEFAULT_END_OF_DAY_TIME = '20:30';

/** `HH:MM` on :00 or :30 within 18:00-23:00. */
export const EndOfDayTimeSchema = z
  .string()
  .regex(/^\d{2}:(00|30)$/, 'Time must be HH:00 or HH:30')
  .refine((value) => {
    const minutes = Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    return minutes >= END_OF_DAY_FIRST_MINUTE && minutes <= END_OF_DAY_LAST_MINUTE;
  }, 'Time must be between 18:00 and 23:00');

export const DigestPreferenceSchema = z.strictObject({
  enabled: z.boolean().default(true),
  time: EndOfDayTimeSchema.default(DEFAULT_END_OF_DAY_TIME),
  includeNames: z.boolean().default(false),
});
export type DigestPreference = z.output<typeof DigestPreferenceSchema>;

/** The preference key the notifications preference model registers (category `digest.end_of_day`). */
export const END_OF_DAY_DIGEST_KEY = 'digest.end_of_day';
