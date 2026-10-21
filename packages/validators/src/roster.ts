// Bench rosters (#384, part 1 of #39; ADR 0017): the zod schemas of `bench_roster`,
// `bench_roster_entry` and `bench_change_alert` (checked against the tables by
// `packages/db/src/__tests__/matter-graph-validators.test.ts`), the `PortfolioRule` an entry
// carries, the `RosterCandidate` the heuristic roster-PDF parser proposes (#385) and the inputs of
// the roster services: preview (#385), confirm, lookups and supersede (#387), bench-change
// detection and dismissal (#389). `bench_roster.confirmation_state` (#387) is `confirmed` on every
// version the lawyer confirmed; only a draft stays `proposed`. Parsing is always confirmed by the lawyer: a candidate is a
// proposal, never written as is. `RosterCandidate.judges` is the court-published composition as
// printed, kept only until the lawyer confirms a bench; no schema here aggregates by judge
// (PX-9, ME-6). Input objects are strict: an unknown key is an error, not silently dropped.
import { z } from 'zod';

import { ANCHOR_QUOTE_MAX, BENCH_KINDS, CONFIRMATION_STATES } from './matter-graph';

export const BENCH_ROSTER_STATUSES = ['draft', 'active', 'superseded'] as const;
export const BENCH_CHANGE_REASONS = ['hall', 'portfolio'] as const;
export const BENCH_CHANGE_ALERT_STATUSES = ['open', 'dismissed'] as const;

const uuid = z.uuid();
/** A Postgres `date` as Drizzle returns it. */
const day = z.iso.date();
const text = z.string().trim().min(1, 'Must not be blank');
const timestamps = { createdAt: z.date(), updatedAt: z.date() };
/** Keys every roster table may leave to the database on insert. */
const GENERATED = { id: true, createdAt: true, updatedAt: true } as const;

/** Normalised case type: upper-case, no dots or spaces (`WP` for "W.P."). */
const caseTypeCode = z
  .string()
  .refine(
    (value) => value !== '' && value === value.toUpperCase() && !/[.\s]/.test(value),
    'Normalise the case type: upper-case, no dots or spaces',
  );
const rosterYear = z.int().min(1900).max(2200);

// ---------------------------------------------------------------------------------------------
// Portfolio rules and parser candidates.

/** Which matters an entry's bench takes; every key present must match (#387 resolves benches). */
export const PortfolioRuleSchema = z
  .strictObject({
    caseTypes: z.array(caseTypeCode).min(1).exactOptional(),
    yearFrom: rosterYear.exactOptional(),
    yearTo: rosterYear.exactOptional(),
    subjectTags: z.array(text).exactOptional(),
  })
  .refine(
    (rule) =>
      rule.yearFrom === undefined || rule.yearTo === undefined || rule.yearFrom <= rule.yearTo,
    { path: ['yearTo'], message: 'yearTo precedes yearFrom' },
  );

/**
 * Where on the roster document a candidate was read: a location only, because candidates exist
 * before any `anchor` row does (#387 may persist one on confirm).
 */
export const RosterAnchorSchema = z
  .strictObject({
    pageNo: z.int().min(1),
    quote: z.string().max(ANCHOR_QUOTE_MAX),
    charStart: z.int().min(0).exactOptional(),
    charEnd: z.int().min(0).exactOptional(),
    bbox: z
      .strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      .exactOptional(),
  })
  .refine((a) => a.charStart === undefined || a.charEnd === undefined || a.charEnd >= a.charStart, {
    path: ['charEnd'],
    message: 'charEnd precedes charStart',
  });

/** One hall's row as the parser read it (#385), for the lawyer to confirm or correct. */
export const RosterCandidateSchema = z.strictObject({
  hallNo: text,
  /** Display names as printed: the court-published composition, preview only. */
  judges: z.array(text),
  portfolioText: z.string(),
  confidence: z.number().min(0).max(1),
  anchor: RosterAnchorSchema,
});

// ---------------------------------------------------------------------------------------------
// Tables.

const benchRosterShape = {
  id: uuid,
  workspaceId: uuid,
  forumId: uuid,
  effectiveFrom: day,
  effectiveTo: day.nullable(),
  status: z.enum(BENCH_ROSTER_STATUSES),
  version: z.int().min(1),
  sourceDocumentId: uuid.nullable(),
  importedBy: uuid.nullable(),
  note: z.string().nullable(),
  confirmationState: z.enum(CONFIRMATION_STATES),
  ...timestamps,
};
export const BenchRosterSelectSchema = z.object(benchRosterShape);
export const BenchRosterInsertSchema = z
  .object(benchRosterShape)
  .partial({
    ...GENERATED,
    effectiveTo: true,
    status: true,
    sourceDocumentId: true,
    importedBy: true,
    note: true,
    confirmationState: true,
  })
  .refine((r) => r.effectiveTo == null || r.effectiveTo > r.effectiveFrom, {
    path: ['effectiveTo'],
    message: 'effectiveTo must follow effectiveFrom',
  });

const benchRosterEntryShape = {
  id: uuid,
  workspaceId: uuid,
  rosterId: uuid,
  hallId: uuid.nullable(),
  hallNo: text,
  benchId: uuid,
  portfolioText: z.string(),
  portfolioRule: PortfolioRuleSchema.nullable(),
  ...timestamps,
};
export const BenchRosterEntrySelectSchema = z.object(benchRosterEntryShape);
export const BenchRosterEntryInsertSchema = z
  .object(benchRosterEntryShape)
  .partial({ ...GENERATED, hallId: true, portfolioText: true, portfolioRule: true });

const benchChangeAlertShape = {
  id: uuid,
  workspaceId: uuid,
  proceedingId: uuid,
  rosterId: uuid,
  oldBenchId: uuid.nullable(),
  newBenchId: uuid,
  reason: z.enum(BENCH_CHANGE_REASONS),
  status: z.enum(BENCH_CHANGE_ALERT_STATUSES),
  ...timestamps,
};
export const BenchChangeAlertSelectSchema = z.object(benchChangeAlertShape);
export const BenchChangeAlertInsertSchema = z
  .object(benchChangeAlertShape)
  .partial({ ...GENERATED, oldBenchId: true, status: true });

// ---------------------------------------------------------------------------------------------
// Service inputs (#385, #387, #389).

/** Parse a roster document of the workspace into candidates (#385). */
export const PreviewRosterImportInputSchema = z.strictObject({ forumId: uuid, documentId: uuid });

/** One confirmed hall: an existing bench, or the judges to find or create one from (#387). */
export const ConfirmedRosterEntrySchema = z
  .strictObject({
    hallNo: text,
    hallId: uuid.exactOptional(),
    benchId: uuid.exactOptional(),
    judges: z.array(text).min(1).exactOptional(),
    benchKind: z.enum(BENCH_KINDS).exactOptional(),
    portfolioText: z.string().default(''),
    portfolioRule: PortfolioRuleSchema.exactOptional(),
  })
  .refine((e) => e.benchId !== undefined || e.judges !== undefined, {
    path: ['benchId'],
    message: 'Give a benchId or the judges',
  });

/** Confirm a reviewed roster as the forum's active version from `effectiveFrom` (#387). */
export const ConfirmRosterImportInputSchema = z
  .strictObject({
    forumId: uuid,
    effectiveFrom: day,
    effectiveTo: day.exactOptional(),
    sourceDocumentId: uuid.exactOptional(),
    note: text.exactOptional(),
    entries: z.array(ConfirmedRosterEntrySchema).min(1),
  })
  .refine((r) => r.effectiveTo === undefined || r.effectiveTo > r.effectiveFrom, {
    path: ['effectiveTo'],
    message: 'effectiveTo must follow effectiveFrom',
  });

/** The forum's active roster on a day (#387). */
export const GetRosterAtInputSchema = z.strictObject({ forumId: uuid, on: day });

/** The bench sitting in a hall on a day, by hall id or hall number (#387). */
export const ResolveBenchForHallInputSchema = z
  .strictObject({
    forumId: uuid,
    on: day,
    hallId: uuid.exactOptional(),
    hallNo: text.exactOptional(),
  })
  .refine((r) => r.hallId !== undefined || r.hallNo !== undefined, {
    path: ['hallId'],
    message: 'Give a hallId or a hallNo',
  });

export const ListRostersInputSchema = z.strictObject({
  forumId: uuid.exactOptional(),
  status: z.enum(BENCH_ROSTER_STATUSES).exactOptional(),
});

/** End an active roster where a newer one takes over (#387). */
export const SupersedeRosterInputSchema = z.strictObject({ rosterId: uuid, effectiveFrom: day });

/** Compare the proceedings' benches before and under a newly active roster (#389). */
export const DetectBenchChangesInputSchema = z.strictObject({ rosterId: uuid });

export const DismissBenchChangeAlertInputSchema = z.strictObject({ alertId: uuid });

/** The workspace's bench-change alerts, narrowed by status, roster or proceeding (#389). */
export const ListBenchChangeAlertsInputSchema = z.strictObject({
  status: z.enum(BENCH_CHANGE_ALERT_STATUSES).exactOptional(),
  rosterId: uuid.exactOptional(),
  proceedingId: uuid.exactOptional(),
});

export type BenchRosterStatus = (typeof BENCH_ROSTER_STATUSES)[number];
export type BenchChangeReason = (typeof BENCH_CHANGE_REASONS)[number];
export type BenchChangeAlertStatus = (typeof BENCH_CHANGE_ALERT_STATUSES)[number];
export type PortfolioRule = z.output<typeof PortfolioRuleSchema>;
export type RosterAnchor = z.output<typeof RosterAnchorSchema>;
export type RosterCandidate = z.output<typeof RosterCandidateSchema>;
export type BenchRoster = z.output<typeof BenchRosterSelectSchema>;
export type NewBenchRoster = z.input<typeof BenchRosterInsertSchema>;
export type BenchRosterEntry = z.output<typeof BenchRosterEntrySelectSchema>;
export type NewBenchRosterEntry = z.input<typeof BenchRosterEntryInsertSchema>;
export type BenchChangeAlert = z.output<typeof BenchChangeAlertSelectSchema>;
export type NewBenchChangeAlert = z.input<typeof BenchChangeAlertInsertSchema>;
export type PreviewRosterImportInput = z.input<typeof PreviewRosterImportInputSchema>;
export type ConfirmedRosterEntry = z.input<typeof ConfirmedRosterEntrySchema>;
export type ConfirmRosterImportInput = z.input<typeof ConfirmRosterImportInputSchema>;
export type GetRosterAtInput = z.input<typeof GetRosterAtInputSchema>;
export type ResolveBenchForHallInput = z.input<typeof ResolveBenchForHallInputSchema>;
export type ListRostersInput = z.input<typeof ListRostersInputSchema>;
export type SupersedeRosterInput = z.input<typeof SupersedeRosterInputSchema>;
export type DetectBenchChangesInput = z.input<typeof DetectBenchChangesInputSchema>;
export type DismissBenchChangeAlertInput = z.input<typeof DismissBenchChangeAlertInputSchema>;
export type ListBenchChangeAlertsInput = z.input<typeof ListBenchChangeAlertsInputSchema>;
