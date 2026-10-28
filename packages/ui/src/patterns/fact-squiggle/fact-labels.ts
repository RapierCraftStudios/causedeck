// The fact-check labels and status type on their own, with no component imports, so a hook such as
// useFactNavigation can load without the squiggle's drawer and popover.
import type { FactCardLabels } from './fact-card';

/** Mirrors the drafting fact-check verdicts; kept local so the UI package does not import drafting. */
export type FactStatus = 'match' | 'mismatch' | 'unsupported' | 'unverified-citation' | 'ambiguous';

export interface FactLabels extends FactCardLabels {
  status: Record<FactStatus, string>;
  /** Live-region text when keyboard navigation lands on an issue. */
  announce: (args: { index: number; total: number; status: string }) => string;
  noIssues: string;
}

export const DEFAULT_FACT_LABELS: FactLabels = {
  status: {
    mismatch: 'Does not match the record',
    ambiguous: 'Ambiguous in the record',
    'unverified-citation': 'Citation not verified',
    unsupported: 'Not found in the record',
    match: 'Matches the record',
  },
  source: 'From the record',
  noSource: 'The record has no passage for this.',
  fix: 'Fix',
  ignore: 'Ignore',
  ignoreForMatter: 'Ignore for this matter',
  markAssertion: 'Mark as my assertion',
  page: (page) => `Page ${String(page)}`,
  openPage: (page) => `Open page ${String(page)}`,
  announce: ({ index, total, status }) => `Issue ${String(index)} of ${String(total)}: ${status}`,
  noIssues: 'No fact-check issues.',
};
