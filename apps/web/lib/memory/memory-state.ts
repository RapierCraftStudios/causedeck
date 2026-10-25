// The state of the memory screen (#73): the layer tab in the URL, the card view model, the screen
// state (empty, denied, offline) and whether the monthly review is due. Pure and deterministic;
// the page and the matter panel both build cards through `toCardView`.
import type { MemoryItem, MemoryLayer, MemoryValue } from '@causedeck/validators';

/** The tabs in screen order: Profile, Preferences, Matters, Court notes, Clients, Recognition. */
export const MEMORY_TABS = [
  'M1',
  'M2',
  'M3',
  'M4',
  'M6',
  'M7',
] as const satisfies readonly MemoryLayer[];
export type MemoryTab = (typeof MEMORY_TABS)[number];

/** A month has passed once the last review is this many days old. */
export const REVIEW_DUE_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

/** The tab named in `?layer=`; an unknown or missing one is the first tab. */
export function parseMemoryTab(raw: RawParams): MemoryTab {
  const value = raw instanceof URLSearchParams ? raw.get('layer') : raw.layer;
  const first = Array.isArray(value) ? value[0] : value;
  return MEMORY_TABS.find((tab) => tab === first) ?? MEMORY_TABS[0];
}

/** Plain text of a value: a list is joined, a record shows `key: value` pairs. */
export function valueText(value: MemoryValue): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  return Object.entries(value)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(', ');
}

/** `M2.brief_format` reads as `Brief format`. */
export function keyTitle(key: string): string {
  const name = (key.split('.').pop() ?? key).replaceAll('_', ' ').trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** One card as the client holds it: plain data, dates as ISO strings. */
export interface CardView {
  id: string;
  layer: MemoryLayer;
  key: string;
  title: string;
  value: string;
  scope: MemoryItem['scope'];
  matterId: string | null;
  sourceType: MemoryItem['sourceType'];
  confirmationState: MemoryItem['confirmationState'];
  paused: boolean;
  sharedWithChamber: boolean;
  lastUsedAt: string | null;
  updatedAt: string;
}

export function toCardView(item: MemoryItem & { lastUsedAt?: Date | null }): CardView {
  return {
    id: item.id,
    layer: item.layer,
    key: item.key,
    title: keyTitle(item.key),
    value: valueText(item.value),
    scope: item.scope,
    matterId: item.matterId,
    sourceType: item.sourceType,
    confirmationState: item.confirmationState,
    paused: item.status === 'paused',
    sharedWithChamber: item.sharedWithChamber,
    lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
    updatedAt: item.updatedAt.toISOString(),
  };
}

/** Cards of one layer, in the order they arrive. */
export function cardsOfLayer(cards: readonly CardView[], layer: MemoryLayer): CardView[] {
  return cards.filter((card) => card.layer === layer);
}

export type MemoryScreenState = 'ready' | 'empty' | 'denied' | 'offline';

/** What the screen shows: denied wins; nothing saved and nothing proposed is the empty state. */
export function screenState(input: {
  allowed: boolean;
  online: boolean;
  cards: number;
  proposals: number;
}): MemoryScreenState {
  if (!input.allowed) return 'denied';
  if (!input.online) return 'offline';
  return input.cards === 0 && input.proposals === 0 ? 'empty' : 'ready';
}

/** The reminder card shows when the review was never done or a month has passed. */
export function reviewDue(lastReview: Date | null, now: Date): boolean {
  if (lastReview === null) return true;
  return now.getTime() - lastReview.getTime() >= REVIEW_DUE_AFTER_DAYS * DAY_MS;
}
