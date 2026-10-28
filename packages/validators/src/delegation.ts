// Chamber delegation schemas (#63): the inputs and result shapes of the `@causedeck/core` delegation
// services (`assignAppearance`, `reassignAppearance`, `unassign`, `suggestAssignments`,
// `myAppearances`, `chamberOutcomesLive`). Objects are strict. No `any`.
import { z } from 'zod';

import { APPEARANCE_CAPACITY_VALUES } from './court-day';

const uuid = z.uuid();
const day = z.iso.date();

export const DELEGATION_NOTE_MAX = 500;
export const SUGGESTION_KINDS = ['unassigned', 'hall_clash', 'complex_clash'] as const;

const capacity = z.enum(APPEARANCE_CAPACITY_VALUES);
const note = z.string().trim().max(DELEGATION_NOTE_MAX).optional();

/**
 * Assign a member to a listed item. `grantAccess` is the owner's explicit override for a member who
 * cannot see a restricted matter: it adds them to the matter's allow-list and is audited.
 */
export const AssignInput = z.strictObject({
  listingId: uuid,
  memberId: uuid,
  capacity,
  note,
  grantAccess: z.boolean().optional(),
});

/** Move one appearance to another member, keeping the capacity unless a new one is given. */
export const ReassignInput = z.strictObject({
  appearanceId: uuid,
  toMemberId: uuid,
  capacity: capacity.optional(),
  note,
  grantAccess: z.boolean().optional(),
});

/**
 * Move every appearance of a departing member on or after `fromDate` (default today) to another
 * member. Earlier appearances stay with the member, so history is intact.
 */
export const BulkReassignInput = z.strictObject({
  fromMemberId: uuid,
  toMemberId: uuid,
  fromDate: day.optional(),
  grantAccess: z.boolean().optional(),
});

export const UnassignInput = z.strictObject({ appearanceId: uuid });

export const SuggestInput = z.strictObject({ date: day });
export const DayInput = z.strictObject({ date: day });

/** A proposal only: nothing is written until the owner accepts it. */
export const Suggestion = z.strictObject({
  listingId: uuid,
  memberId: uuid,
  capacity,
  kind: z.enum(SUGGESTION_KINDS),
  /** One line saying why. */
  reason: z.string().min(1).max(200),
});

export const SuggestionList = z.strictObject({
  date: day,
  suggestions: z.array(Suggestion),
});

/** The result of an assignment: the appearance and who held it before (null for a new one). */
export const AssignedAppearance = z.strictObject({
  appearanceId: uuid,
  listingId: uuid,
  memberId: uuid,
  capacity,
  note: z.string().nullable(),
  previousMemberId: uuid.nullable(),
  accessGranted: z.boolean(),
});

export const BulkReassignResult = z.strictObject({
  moved: z.int().nonnegative(),
  appearanceIds: z.array(uuid),
});

/** One delegated appearance as the assignee (or a reader of the plan) sees it. */
export const DelegatedAppearance = z.strictObject({
  appearanceId: uuid,
  listingId: uuid,
  matterId: uuid,
  matterTitle: z.string(),
  caseLabel: z.string(),
  listDate: day,
  itemNo: z.string().nullable(),
  hallNo: z.string().nullable(),
  memberId: uuid.nullable(),
  capacity,
  assignedByMemberId: uuid.nullable(),
  /** Absent where the reader lacks `strategy.read` (a clerk). */
  note: z.string().nullable().optional(),
  sensitive: z.boolean(),
});

export const DelegationView = z.strictObject({
  date: day,
  appearances: z.array(DelegatedAppearance),
});

export const MemberOutcomes = z.strictObject({
  memberId: uuid,
  name: z.string(),
  total: z.int().nonnegative(),
  /** Items with a recorded result (outcome, adjournment or next date). */
  heard: z.int().nonnegative(),
  /** Items whose outcome the assignee confirmed. */
  outcomesIn: z.int().nonnegative(),
  items: z.array(
    z.strictObject({
      appearanceId: uuid,
      listingId: uuid,
      itemNo: z.string().nullable(),
      outcome: z.string().nullable(),
      confirmed: z.boolean(),
    }),
  ),
});

export const OutcomesLive = z.strictObject({
  date: day,
  members: z.array(MemberOutcomes),
  /** The newest confirmation time, so a poll can tell what changed. */
  lastConfirmedAt: z.date().nullable(),
});

export type AssignInput = z.input<typeof AssignInput>;
export type ReassignInput = z.input<typeof ReassignInput>;
export type BulkReassignInput = z.input<typeof BulkReassignInput>;
export type UnassignInput = z.input<typeof UnassignInput>;
export type SuggestInput = z.input<typeof SuggestInput>;
export type DayInput = z.input<typeof DayInput>;
export type Suggestion = z.output<typeof Suggestion>;
export type SuggestionList = z.output<typeof SuggestionList>;
export type AssignedAppearance = z.output<typeof AssignedAppearance>;
export type BulkReassignResult = z.output<typeof BulkReassignResult>;
export type DelegatedAppearance = z.output<typeof DelegatedAppearance>;
export type DelegationView = z.output<typeof DelegationView>;
export type MemberOutcomes = z.output<typeof MemberOutcomes>;
export type OutcomesLive = z.output<typeof OutcomesLive>;
