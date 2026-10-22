// The Timeline tab of the matter workspace (#41): registered from lib/matters/tabs.ts for members
// who may read the matter. The tab is the matter's graph of proceedings and its cross-proceeding
// timeline, both derived views. `TIMELINE_KIND_PERMISSIONS` says which permission each kind of
// event needs, so a clerk or viewer sees only the kinds their policy allows (the page filters the
// read, the client never receives the rest). Pure: no core, db or React imports, like the registry.
import { matterTabHref, registerMatterTab } from './tab-registry.ts';

export const TIMELINE_SEGMENT = 'timeline';

/** Timeline: after Proceedings (10), before People (20). */
export function registerTimelineTab(): void {
  registerMatterTab({
    id: 'timeline',
    order: 15,
    labelKey: 'timeline',
    segment: TIMELINE_SEGMENT,
    visible: ({ can }) => can('matter.read'),
  });
}

/** The kinds of timeline event, as `getMatterTimeline` names them. */
export const TIMELINE_KINDS = [
  'listing',
  'hearing',
  'order',
  'obligation_due',
  'obligation_closed',
  'state_change',
  'document_added',
  'bench_change',
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/** The permission that lets a member see each kind (docs/engineering/permissions.md). */
export const TIMELINE_KIND_PERMISSIONS = {
  listing: 'listing.read',
  hearing: 'listing.read',
  order: 'listing.read',
  obligation_due: 'task.read',
  obligation_closed: 'task.read',
  state_change: 'matter.read',
  document_added: 'document.read',
  bench_change: 'listing.read',
} as const satisfies Record<TimelineKind, string>;

/** The kinds of event `can` lets through. */
export function allowedTimelineKinds(can: (permission: string) => boolean): TimelineKind[] {
  return TIMELINE_KINDS.filter((kind) => can(TIMELINE_KIND_PERMISSIONS[kind]));
}

/** The Timeline tab of a matter, with the view's query (`p`, `k`, `from`, `to`, `proposed`, `mode`). */
export function timelineTabHref(
  slug: string,
  matterId: string,
  query?: Readonly<Record<string, string | undefined>>,
): string {
  const base = matterTabHref(slug, matterId, { segment: TIMELINE_SEGMENT });
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const text = params.toString();
  return text === '' ? base : `${base}?${text}`;
}

export const QUALIFIER_KEYS = {
  daily: 'qualifier.daily',
  advance: 'qualifier.advance',
  supplementary: 'qualifier.supplementary',
  special: 'qualifier.special',
  interim: 'qualifier.interim',
  final: 'qualifier.final',
  procedural: 'qualifier.procedural',
  pleading: 'qualifier.pleading',
  ia: 'qualifier.ia',
  annexure: 'qualifier.annexure',
  order: 'qualifier.order',
  judgment: 'qualifier.judgment',
  cause_list: 'qualifier.cause_list',
  correspondence: 'qualifier.correspondence',
  note: 'qualifier.note',
  draft: 'qualifier.draft',
  registry_memo: 'qualifier.registry_memo',
  other: 'qualifier.other',
} as const;

export function isQualifier(value: string | null): value is keyof typeof QUALIFIER_KEYS {
  return value !== null && value in QUALIFIER_KEYS;
}
