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
  getPreferences,
  LIST_LIMIT_MAX,
  listForUser,
  markAllRead,
  markRead,
  notify,
  setPreference,
  unreadCount,
  type DeliveryJob,
  type NotificationContext,
  type NotificationItem,
  type NotifyContext,
  type NotifyInput,
  type ResolvedPreference,
} from './service.ts';
