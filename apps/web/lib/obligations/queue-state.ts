// The state of the obligation queue screen (#68) that lives in the URL: the tab, the filters and
// the search. `parseQueueParams` reads it (unknown or malformed values are dropped, never thrown on),
// `serialiseQueueParams` writes only what differs from the default, and `filterQueue` narrows the
// loaded rows on the client. `suggestNextStep` drafts the one next step of a row from its kind; it
// is deterministic and sends nothing: a task, an internal reminder, or a client letter that is
// kept as an internal task (a draft) until the letter drafts of #69 land.
import type { QueueGroup } from '@causedeck/validators/obligation';

export const QUEUE_GROUP_ORDER = ['overdue', 'today', 'this_week', 'later', 'undated'] as const;
export const OBLIGATION_KINDS = [
  'order_direction',
  'rule',
  'registry_defect',
  'client',
  'internal',
  'certified_copy',
] as const;
export type ObligationKindValue = (typeof OBLIGATION_KINDS)[number];
export const OBLIGATION_TABS = ['queue', 'defects', 'copies'] as const;
export type ObligationTab = (typeof OBLIGATION_TABS)[number];

/** One queue row as the client holds it: plain data, dates as `YYYY-MM-DD`. */
export interface QueueItem {
  id: string;
  group: QueueGroup;
  matterId: string;
  matterTitle: string;
  caseNumber: string | null;
  description: string;
  dueDate: string | null;
  source: ObligationKindValue;
  sourceType: string;
  status: string;
  ownerMemberId: string | null;
  ownerName: string | null;
  sourceQuote: string | null;
  basis: string | null;
}

export interface QueueFilters {
  matter?: string | undefined;
  owner?: string | undefined;
  kind?: ObligationKindValue | undefined;
  source?: string | undefined;
  group?: QueueGroup | undefined;
  q?: string | undefined;
}

export interface QueueParams {
  tab: ObligationTab;
  filters: QueueFilters;
}

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function pick(raw: RawParams, key: string): string | undefined {
  const value = raw instanceof URLSearchParams ? (raw.get(key) ?? undefined) : raw[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first.trim() === '' ? undefined : first.trim();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const oneOf = <T extends string>(list: readonly T[], value: string | undefined): T | undefined =>
  list.find((item) => item === value);

export function parseQueueParams(raw: RawParams): QueueParams {
  const matter = pick(raw, 'matter');
  const owner = pick(raw, 'owner');
  const q = pick(raw, 'q');
  return {
    tab: oneOf(OBLIGATION_TABS, pick(raw, 'tab')) ?? 'queue',
    filters: {
      matter: matter !== undefined && UUID.test(matter) ? matter : undefined,
      owner: owner !== undefined && UUID.test(owner) ? owner : undefined,
      kind: oneOf(OBLIGATION_KINDS, pick(raw, 'kind')),
      source: pick(raw, 'source'),
      group: oneOf(QUEUE_GROUP_ORDER, pick(raw, 'group')),
      q: q === undefined ? undefined : q.slice(0, 200),
    },
  };
}

export function serialiseQueueParams({ tab, filters }: QueueParams): URLSearchParams {
  const out = new URLSearchParams();
  if (tab !== 'queue') out.set('tab', tab);
  for (const key of ['matter', 'owner', 'kind', 'source', 'group', 'q'] as const) {
    const value = filters[key];
    if (value !== undefined && value !== '') out.set(key, value);
  }
  return out;
}

export function hasFilters(filters: QueueFilters): boolean {
  return Object.values(filters).some((value) => value !== undefined && value !== '');
}

/** Narrow the rows by every filter that is set; the search matches words in text, matter and owner. */
export function filterQueue(items: readonly QueueItem[], filters: QueueFilters): QueueItem[] {
  const words = (filters.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (filters.matter !== undefined && item.matterId !== filters.matter) return false;
    if (filters.owner !== undefined && item.ownerMemberId !== filters.owner) return false;
    if (filters.kind !== undefined && item.source !== filters.kind) return false;
    if (filters.source !== undefined && item.sourceType !== filters.source) return false;
    if (filters.group !== undefined && item.group !== filters.group) return false;
    if (words.length === 0) return true;
    const hay = [item.description, item.matterTitle, item.caseNumber ?? '', item.ownerName ?? '']
      .join(' ')
      .toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

export function groupItems(items: readonly QueueItem[]): Record<QueueGroup, QueueItem[]> {
  const out: Record<QueueGroup, QueueItem[]> = {
    overdue: [],
    today: [],
    this_week: [],
    later: [],
    undated: [],
  };
  for (const item of items) out[item.group].push(item);
  return out;
}

export type NextStepType = 'task' | 'reminder' | 'letter';

export interface NextStep {
  type: NextStepType;
  /** The text of the task or the draft; the card translates the lead-in. */
  text: string;
}

/**
 * The one drafted next step of an obligation: a client obligation gets a letter draft, a registry
 * defect or certified copy a reminder to the clerk, anything else a task. Nothing is ever sent.
 */
export function suggestNextStep(item: Pick<QueueItem, 'source' | 'description'>): NextStep {
  const text = item.description.trim().slice(0, 300);
  if (item.source === 'client') return { type: 'letter', text };
  if (item.source === 'registry_defect' || item.source === 'certified_copy') {
    return { type: 'reminder', text };
  }
  return { type: 'task', text };
}
