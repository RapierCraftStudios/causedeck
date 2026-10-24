/** Email, web push, in-app notifications, digests. */
export const packageName: string = '@causedeck/notifications';

export {
  CATEGORIES,
  CATEGORY_KEYS,
  CHANNELS,
  DIGESTS,
  isCategoryKey,
  isLockedChannel,
  type CategoryDefinition,
  type CategoryKey,
  type Channel,
  type Digest,
} from './categories.ts';
export { NotificationError, type NotificationErrorCode } from './errors.ts';
export { COURT_HOURS, isQuietTime, localMinutes, type QuietSetting } from './quiet-hours.ts';
export {
  DEFAULT_NOTIFICATION_SETTINGS,
  getDigest,
  getEndOfDayPreference,
  getNotificationSetting,
  getPreferences,
  LIST_LIMIT_MAX,
  listForUser,
  markAllRead,
  markRead,
  notify,
  setBenchAlertPartyNames,
  setCourtHoursQuiet,
  setDigest,
  setEndOfDayPreference,
  setLockScreenDetails,
  setPreference,
  unreadCount,
  type DeliveryJob,
  type EndOfDayPreference,
  type NotificationContext,
  type NotificationItem,
  type NotificationSettings,
  type NotifyContext,
  type NotifyInput,
  type ResolvedPreference,
} from './service.ts';
export {
  buildEndOfDayDigest,
  type EndOfDayDigestInput,
  type EndOfDayDigestPayload,
} from './digest/end-of-day.ts';
export {
  DEFAULT_END_OF_DAY_TIME,
  END_OF_DAY_ZONE,
  endOfDaySlot,
  isDigestTimeOfDay,
  localDateOf,
  localDayBounds,
  type EndOfDaySlot,
} from './digest/schedule.ts';
