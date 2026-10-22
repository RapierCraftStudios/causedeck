// The matters list's URL contract (#388): the URL is the only state of the list. Filters, search,
// sort and the keyset cursor are query params, so a list can be shared, reloaded and walked with
// Back. Unknown or malformed values are dropped (never an error), and any change other than paging
// drops the cursor, because a cursor belongs to one filter set and sort (`searchMatters` refuses a
// cursor from another sort). Pure and client-safe: no zod or validators values here, which would
// land in the route's JS (25 KB budget); `__tests__/matters-page.test.tsx` pins the lists below to
// the validators' enums.
import type { SearchMattersInput } from '@causedeck/validators/matter-graph-inputs';

export type MatterStatus = NonNullable<SearchMattersInput['status']>;
export type MatterSort = NonNullable<SearchMattersInput['sort']>;

export const MATTER_LIST_STATUSES = [
  'active',
  'disposed',
  'archived',
] as const satisfies readonly MatterStatus[];
export const MATTER_LIST_SORTS = [
  'next_date',
  'updated',
  'title',
] as const satisfies readonly MatterSort[];
export const DEFAULT_MATTER_SORT: MatterSort = 'next_date';

/** The page size of the list (keyset pages of 50). */
export const MATTER_PAGE_SIZE = 50;

export type SearchParams = Record<string, string | string[] | undefined>;

export interface MatterListState {
  status?: MatterStatus | undefined;
  /** A forum id: matters with any proceeding before it. */
  forum?: string | undefined;
  /** An owner's member id. */
  owner?: string | undefined;
  noNextDate?: boolean | undefined;
  sensitive?: boolean | undefined;
  q?: string | undefined;
  sort: MatterSort;
  cursor?: string | undefined;
}

export type MatterListPatch = { [K in keyof MatterListState]?: MatterListState[K] | undefined };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | undefined {
  return values.find((entry) => entry === value);
}

/** The list state a URL describes; anything malformed is left out. */
export function parseMatterListState(searchParams: SearchParams): MatterListState {
  const status = oneOf(MATTER_LIST_STATUSES, first(searchParams.status));
  const forum = first(searchParams.forum);
  const owner = first(searchParams.owner);
  const q = first(searchParams.q)?.trim();
  const cursor = first(searchParams.cursor);
  return {
    ...(status === undefined ? {} : { status }),
    ...(forum !== undefined && UUID.test(forum) ? { forum } : {}),
    ...(owner !== undefined && UUID.test(owner) ? { owner } : {}),
    ...(first(searchParams.noNextDate) === '1' ? { noNextDate: true } : {}),
    ...(first(searchParams.sensitive) === '1' ? { sensitive: true } : {}),
    ...(q !== undefined && q !== '' && q.length <= 200 ? { q } : {}),
    sort: oneOf(MATTER_LIST_SORTS, first(searchParams.sort)) ?? DEFAULT_MATTER_SORT,
    ...(cursor !== undefined && cursor !== '' && cursor.length <= 1000 ? { cursor } : {}),
  };
}

/** The `searchMatters` input of a list state: 50 per page. */
export function toSearchMattersInput(state: MatterListState): SearchMattersInput {
  return {
    ...(state.status === undefined ? {} : { status: state.status }),
    ...(state.forum === undefined ? {} : { forumId: state.forum }),
    ...(state.owner === undefined ? {} : { ownerMemberId: state.owner }),
    ...(state.noNextDate === true ? { noNextDate: true } : {}),
    ...(state.sensitive === true ? { sensitive: true } : {}),
    ...(state.q === undefined ? {} : { q: state.q }),
    sort: state.sort,
    limit: MATTER_PAGE_SIZE,
    ...(state.cursor === undefined ? {} : { cursor: state.cursor }),
  };
}

/** URL params straight to the `searchMatters` input. */
export function parseMatterListParams(searchParams: SearchParams): SearchMattersInput {
  return toSearchMattersInput(parseMatterListState(searchParams));
}

/** Whether any filter or search narrows the list (the sort does not). */
export function hasMatterFilters(state: MatterListState): boolean {
  return (
    state.status !== undefined ||
    state.forum !== undefined ||
    state.owner !== undefined ||
    state.noNextDate === true ||
    state.sensitive === true ||
    state.q !== undefined
  );
}

/** `/w/{slug}/matters`, the list. */
export function mattersHref(slug: string): string {
  return `/w/${encodeURIComponent(slug)}/matters`;
}

/** A matter's workspace (#390). */
export function matterHref(slug: string, id: string): string {
  return `${mattersHref(slug)}/${encodeURIComponent(id)}`;
}

/**
 * The list URL after `patch`. Changing anything but the cursor starts again at the first page;
 * the default sort and off toggles are left out of the URL.
 */
export function matterListHref(
  slug: string,
  state: MatterListState,
  patch: MatterListPatch = {},
): string {
  const paging = Object.keys(patch).every((key) => key === 'cursor');
  const next: MatterListState = {
    ...state,
    ...(paging ? {} : { cursor: undefined }),
    ...patch,
    sort: patch.sort ?? state.sort,
  };
  const params = new URLSearchParams();
  if (next.q !== undefined && next.q.trim() !== '') params.set('q', next.q.trim());
  if (next.status !== undefined) params.set('status', next.status);
  if (next.forum !== undefined) params.set('forum', next.forum);
  if (next.owner !== undefined) params.set('owner', next.owner);
  if (next.noNextDate === true) params.set('noNextDate', '1');
  if (next.sensitive === true) params.set('sensitive', '1');
  if (next.sort !== DEFAULT_MATTER_SORT) params.set('sort', next.sort);
  if (next.cursor !== undefined) params.set('cursor', next.cursor);
  const query = params.toString();
  return query === '' ? mattersHref(slug) : `${mattersHref(slug)}?${query}`;
}
