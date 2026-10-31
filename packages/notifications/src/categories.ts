// The notification category registry (#194, #23): every notification has one category, which
// decides its default channels and whether the member may turn it off. Pure and client-safe (the
// preferences UI imports it through `@causedeck/notifications/categories`): no database imports.

export const CHANNELS = ['in_app', 'email', 'push', 'whatsapp'] as const;
export type Channel = (typeof CHANNELS)[number];

/** `instant` sends as it happens, `daily` waits for the digest (#196), `off` never sends. */
export const DIGESTS = ['instant', 'daily', 'off'] as const;
export type Digest = (typeof DIGESTS)[number];

export interface CategoryDefinition {
  /** Channels on when the member has no preference row. */
  readonly defaultChannels: readonly Channel[];
  /** A mandatory category has channels the member cannot turn off (`lockedChannels`). */
  readonly mandatory: boolean;
  /** Always enabled and instant, whatever the preference rows say. */
  readonly lockedChannels: readonly Channel[];
}

export const CATEGORIES = {
  'workspace.invite': {
    defaultChannels: ['in_app', 'email'],
    mandatory: false,
    lockedChannels: [],
  },
  'member.joined': { defaultChannels: ['in_app'], mandatory: false, lockedChannels: [] },
  'security.alert': {
    defaultChannels: ['in_app', 'email', 'push'],
    mandatory: true,
    lockedChannels: ['in_app', 'email'],
  },
  'billing.notice': { defaultChannels: ['in_app', 'email'], mandatory: false, lockedChannels: [] },
  'reminder.hearing': {
    defaultChannels: ['in_app', 'email', 'push'],
    mandatory: false,
    lockedChannels: [],
  },
  // Court-day display-board alerts (#493): N away, now, risen, passed over.
  'court.board': { defaultChannels: ['in_app', 'push'], mandatory: false, lockedChannels: [] },
  'proposal.new': { defaultChannels: ['in_app', 'push'], mandatory: false, lockedChannels: [] },
  'judgment.alert': { defaultChannels: ['in_app', 'push'], mandatory: false, lockedChannels: [] },
  // Case-status change alerts (#592): a watched case shows a new next date, a new order or a new stage.
  'status.next_date': { defaultChannels: ['in_app', 'push'], mandatory: false, lockedChannels: [] },
  'status.order': { defaultChannels: ['in_app', 'push'], mandatory: false, lockedChannels: [] },
  'status.stage': { defaultChannels: ['in_app', 'push'], mandatory: false, lockedChannels: [] },
  // Institution portfolio exception alerts (#665, #498): a new adverse order, a missed next date.
  'portfolio.adverse_order': {
    defaultChannels: ['in_app', 'email', 'push'],
    mandatory: false,
    lockedChannels: [],
  },
  'portfolio.missed_date': {
    defaultChannels: ['in_app', 'email', 'push'],
    mandatory: false,
    lockedChannels: [],
  },
  // Official court and bar notices matched to the member's forums and matters (#587, D-048).
  // Bench-notice alerts (#496): a leave, special bench or roster notice affects a listed matter.
  bench_change: { defaultChannels: ['in_app', 'push'], mandatory: false, lockedChannels: [] },
  notices: { defaultChannels: ['in_app', 'push'], mandatory: false, lockedChannels: [] },
  'digest.daily': { defaultChannels: ['email'], mandatory: false, lockedChannels: [] },
  // "What CauseDeck did today" (#49): counts of what the system did on its own, once per local day.
  'digest.end_of_day': {
    defaultChannels: ['in_app', 'email'],
    mandatory: false,
    lockedChannels: [],
  },
  // The legal news digest (#481): headlines and links to the original, at most one a day.
  'digest.news': {
    defaultChannels: ['in_app', 'email', 'push'],
    mandatory: false,
    lockedChannels: [],
  },
  // Court-day reminders (#64): the evening brief, the morning list diff, the missing-outcome nudge.
  'reminder.evening': {
    defaultChannels: ['in_app', 'push', 'email'],
    mandatory: false,
    lockedChannels: [],
  },
  'reminder.morning': {
    defaultChannels: ['in_app', 'push', 'email'],
    mandatory: false,
    lockedChannels: [],
  },
  'reminder.outcome_missing': {
    defaultChannels: ['in_app', 'push', 'email'],
    mandatory: false,
    lockedChannels: [],
  },
  // Onboarding nudges (#601): a reminder for the next unfinished setup step, in the app by default;
  // WhatsApp is opt-in through the member's WhatsApp link (the template carries a link only).
  'onboarding.nudge': { defaultChannels: ['in_app'], mandatory: false, lockedChannels: [] },
  'system.notice': { defaultChannels: ['in_app'], mandatory: false, lockedChannels: [] },
} as const satisfies Record<string, CategoryDefinition>;

export type CategoryKey = keyof typeof CATEGORIES;

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];

export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === 'string' && Object.hasOwn(CATEGORIES, value);
}

/** The member cannot disable `channel` for `category` (e.g. `security.alert` in-app and email). */
export function isLockedChannel(category: CategoryKey, channel: Channel): boolean {
  return (CATEGORIES[category].lockedChannels as readonly Channel[]).includes(channel);
}
