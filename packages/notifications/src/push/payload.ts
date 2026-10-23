// Push payloads (#197, #23 security/privacy). A push is shown on the lock screen, so by default it
// carries no matter names, party names or document text: a generic title for the category and a
// deep link only. The member's `Show details on lock screen` setting (default off) adds the
// notification's own title and body. Pure: no database or network imports.
import { isCategoryKey, type CategoryKey } from '../categories.ts';

export interface PushPayload {
  title: string;
  body?: string;
  /** Absolute app link opened on click. */
  href: string;
  /** Replaces an earlier push for the same notification rather than stacking. */
  tag: string;
}

/** Content-free titles, one per category. Brief, calm, factual. */
export const GENERIC_PUSH_TITLES: Record<CategoryKey, string> = {
  'workspace.invite': 'New workspace invitation',
  'member.joined': 'A member joined your workspace',
  'security.alert': 'Security alert',
  'billing.notice': 'Billing update',
  'reminder.hearing': 'Hearing reminder',
  'court.board': 'Your item is coming up in court',
  'proposal.new': 'New proposal to review',
  'judgment.alert': 'New judgment on one of your matters',
  'digest.daily': 'Your daily digest is ready',
  'digest.end_of_day': 'What CauseDeck did today',
  'system.notice': 'New notification',
};

const FALLBACK_TITLE = 'New notification';
const MAX_TITLE = 120;
const MAX_BODY = 240;

export interface PushPayloadInput {
  notificationId: string;
  category: string;
  title: string;
  body: string | null;
  href: string;
  /** `Show details on lock screen`; off unless the member turned it on. */
  showDetails: boolean;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The JSON a push carries. With `showDetails` off it never contains the row's title or body. */
export function buildPushPayload(input: PushPayloadInput): PushPayload {
  const base = { href: input.href, tag: `n:${input.notificationId}` };
  if (!input.showDetails) {
    const title = isCategoryKey(input.category)
      ? GENERIC_PUSH_TITLES[input.category]
      : FALLBACK_TITLE;
    return { title, ...base };
  }
  const body = input.body?.trim();
  return {
    title: clip(input.title, MAX_TITLE),
    ...(body ? { body: clip(body, MAX_BODY) } : {}),
    ...base,
  };
}
