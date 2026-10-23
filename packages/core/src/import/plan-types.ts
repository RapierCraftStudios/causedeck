// The `ImportPlan` (#57 part 2, #548): what the bootstrap import proposes and the confirm grid
// edits. It holds matched rows and their clusters only: no field can carry the content of a list
// row that did not match the advocate (`unmatchedRowsCount` is a counter). Plain data, no clocks,
// so the same inputs always serialise to the same JSON (the golden plan tests rely on it).

/** Where a proposed value came from: a staged proposal and its anchors, never row text. */
export interface PlanSource {
  proposalId: string;
  captureId: string | null;
  kind: string;
  anchorIds: string[];
}

export interface PlanDate {
  /** `YYYY-MM-DD`. */
  date: string;
  sources: PlanSource[];
}

export interface PlanProceeding {
  /** The adapter match key (or the proceeding id of a staged next date): the stable handle. */
  key: string;
  /** A case number label such as `W.P. 1234/2024`; null when the drafts gave none. */
  label: string | null;
  caseType: string | null;
  caseNumber: string | null;
  caseYear: number | null;
  forumCode: string | null;
  cnr: string | null;
  parentKey: string | null;
  parties: string | null;
  stage: string | null;
  /** A date >= today (IST) with one source of truth; null when none or when sources conflict. */
  nextDate: PlanDate | null;
  /** Every future date claimed; more than one means the sources conflict (a blocking issue). */
  nextDateCandidates: PlanDate[];
  sources: PlanSource[];
}

export const PLAN_ISSUE_CODES = ['conflicting_dates', 'low_confidence'] as const;
export type PlanIssueCode = (typeof PLAN_ISSUE_CODES)[number];

export interface PlanIssue {
  code: PlanIssueCode;
  /** A blocking issue keeps the row out of the confirm until the lawyer resolves it. */
  blocking: boolean;
  proceedingKey?: string;
  dates?: string[];
}

export interface PlanMatter {
  tempId: string;
  title: string;
  proceedings: PlanProceeding[];
  /** The earliest next date of its proceedings; null when none or all conflict. */
  nextDate: PlanDate | null;
  issues: PlanIssue[];
  /** 0..1: the weakest link of the grouping and the weakest draft in it. */
  confidence: number;
  /** Why the proceedings are grouped, e.g. `main petition with child proceedings`. */
  reason: string;
  sources: PlanSource[];
}

/** A past date: a hearing or order for the timeline, never a next date. */
export interface PlanHistoryEntry {
  matterTempId: string;
  proceedingKey: string;
  date: string;
  sources: PlanSource[];
}

export interface PlanObligation {
  matterTempId: string;
  title: string;
  dueDate: string | null;
  sources: PlanSource[];
}

export interface ImportPlan {
  version: 1;
  /** The IST calendar date the plan was classified against. */
  today: string;
  matters: PlanMatter[];
  history: PlanHistoryEntry[];
  obligations: PlanObligation[];
  counts: { matchedRows: number; unmatchedRowsCount: number };
}
