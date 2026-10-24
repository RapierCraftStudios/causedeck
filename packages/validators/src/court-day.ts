// Court-day schemas (#58): the query and result shapes of the `@causedeck/core` court-day services
// (`getCourtDay`, `detectClashes`, `snapshotList`, `diffLists`, `setCurrentItem`). Objects are strict.
// Item numbers stay text as printed; the services order them numerically. No `any`.
import { z } from 'zod';

const uuid = z.uuid();
const day = z.iso.date();

export const COURT_DAY_SCOPES = ['mine', 'workspace'] as const;
export const COURT_DAY_LIST_TYPES = ['daily', 'advance', 'supplementary', 'special'] as const;
export const COURT_DAY_SOURCE_TYPES = [
  'manual',
  'document',
  'capture',
  'adapter',
  'ai',
  'import',
  'system',
] as const;
export const COURT_DAY_CONFIRMATION_STATES = [
  'proposed',
  'confirmed',
  'auto_applied',
  'corrected',
] as const;
export const APPEARANCE_CAPACITY_VALUES = [
  'aor',
  'arguing',
  'for_other',
  'proxy',
  'assisting',
] as const;
export const CLASH_KINDS = ['hall', 'complex'] as const;
export const LIST_DIFF_KINDS = ['added', 'removed', 'moved', 'stage_changed'] as const;

export const CourtDayQuery = z.strictObject({
  date: day,
  scope: z.enum(COURT_DAY_SCOPES).default('mine'),
});

const text = z.string().min(1);
const nullableText = z.string().nullable();

/** One listed item. `stageNorm`, `confidence` and `matterMemory` are absent where hidden. */
export const CourtDayItem = z.strictObject({
  listingId: uuid,
  proceedingId: uuid,
  matterId: uuid,
  matterTitle: z.string(),
  caseLabel: z.string(),
  listType: z.enum(COURT_DAY_LIST_TYPES),
  listNo: z.int().nullable(),
  itemNo: nullableText,
  hallId: uuid.nullable(),
  hallNo: nullableText,
  stageRaw: z.string(),
  stageNorm: nullableText.optional(),
  bench: z.array(z.string()),
  capacity: z.enum(APPEARANCE_CAPACITY_VALUES).nullable(),
  appearingMemberIds: z.array(uuid),
  assigneeMemberId: uuid.nullable(),
  openObligations: z.int().nonnegative(),
  carryCount: z.int().nonnegative(),
  sourceType: z.enum(COURT_DAY_SOURCE_TYPES),
  anchorId: uuid.nullable(),
  confidence: nullableText.optional(),
  confirmationState: z.enum(COURT_DAY_CONFIRMATION_STATES),
  sensitive: z.boolean(),
  matterMemory: nullableText.optional(),
});

export const CourtDayList = z.strictObject({
  listType: z.enum(COURT_DAY_LIST_TYPES),
  items: z.array(CourtDayItem),
});

export const CourtDayMarkerView = z.strictObject({
  currentItem: z.int().positive(),
  setBy: uuid.nullable(),
  setAt: z.date(),
  /** A strategy-bearing note: absent from the clerk payload. */
  note: nullableText.optional(),
});

export const CourtDayHall = z.strictObject({
  hallId: uuid.nullable(),
  hallNo: nullableText,
  marker: CourtDayMarkerView.nullable(),
  lists: z.array(CourtDayList),
});

export const CourtDayComplex = z.strictObject({
  forumId: uuid,
  name: z.string(),
  halls: z.array(CourtDayHall),
});

export const ExpectedNotListed = z.strictObject({
  proceedingId: uuid,
  matterId: uuid,
  matterTitle: z.string(),
  caseLabel: z.string(),
});

export const CourtDay = z.strictObject({
  date: day,
  scope: z.enum(COURT_DAY_SCOPES),
  complexes: z.array(CourtDayComplex),
  expectedNotListed: z.array(ExpectedNotListed),
  /** The newest capture time among the listed items; null for an empty day. */
  freshness: z.date().nullable(),
});

export const ClashItem = z.strictObject({
  listingId: uuid,
  proceedingId: uuid,
  forumId: uuid,
  hallId: uuid.nullable(),
  itemNo: nullableText,
});

/** A factual clash: the same member, the same date, different halls or complexes. No time claim. */
export const Clash = z.strictObject({
  kind: z.enum(CLASH_KINDS),
  date: day,
  memberId: uuid,
  items: z.tuple([ClashItem, ClashItem]),
  statement: text,
});

export const SnapshotRow = z.strictObject({
  proceedingKey: text,
  hallNo: nullableText,
  itemNo: nullableText,
  stage: nullableText,
});

export const SnapshotListInput = z.strictObject({
  forumId: uuid,
  listDate: day,
  listType: z.enum(COURT_DAY_LIST_TYPES),
  rows: z.array(SnapshotRow),
  sourceCaptureId: uuid.nullish(),
});

export const ListDiffEntry = z.strictObject({
  kind: z.enum(LIST_DIFF_KINDS),
  proceedingKey: text,
  before: SnapshotRow.nullable(),
  after: SnapshotRow.nullable(),
});

export const ListDiff = z.strictObject({
  /** `supplementary` when a daily list is compared with its later supplementary list. */
  label: z.enum(['changed', 'supplementary']),
  added: z.array(ListDiffEntry),
  removed: z.array(ListDiffEntry),
  moved: z.array(ListDiffEntry),
  stage_changed: z.array(ListDiffEntry),
  /** Every entry once, in display order: new rows first for a supplementary list. */
  entries: z.array(ListDiffEntry),
});

export const CurrentItemMarker = z.strictObject({
  hallId: uuid,
  listDate: day,
  currentItem: z.int().positive(),
  note: z.string().trim().max(500).nullish(),
});

export const ClearCurrentItemInput = z.strictObject({ hallId: uuid, listDate: day });

export type CourtDayQuery = z.input<typeof CourtDayQuery>;
export type ParsedCourtDayQuery = z.output<typeof CourtDayQuery>;
export type CourtDayItem = z.output<typeof CourtDayItem>;
export type CourtDayList = z.output<typeof CourtDayList>;
export type CourtDayHall = z.output<typeof CourtDayHall>;
export type CourtDayComplex = z.output<typeof CourtDayComplex>;
export type CourtDay = z.output<typeof CourtDay>;
export type ExpectedNotListed = z.output<typeof ExpectedNotListed>;
export type Clash = z.output<typeof Clash>;
export type ClashItem = z.output<typeof ClashItem>;
export type SnapshotRow = z.output<typeof SnapshotRow>;
export type SnapshotListInput = z.input<typeof SnapshotListInput>;
export type ListDiff = z.output<typeof ListDiff>;
export type ListDiffEntry = z.output<typeof ListDiffEntry>;
export type CurrentItemMarker = z.input<typeof CurrentItemMarker>;
export type ClearCurrentItemInput = z.input<typeof ClearCurrentItemInput>;
