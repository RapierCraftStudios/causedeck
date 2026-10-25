// The Brief Sheet's view model (#61): the sections in PRD PR-1 order, the stale note rule and the
// print title. Pure, so it is tested without a DOM.
import type { Brief, Readiness } from '@causedeck/validators';

/** The PR-1 order; the digit keys 1-9 jump to the visible ones in this order. */
export const SECTION_ORDER = [
  'stage',
  'last_order',
  'obligations',
  'carry',
  'synopsis',
  'last_hearing',
  'court_notes',
  'context',
] as const;
export type SectionKey = (typeof SECTION_ORDER)[number];

export const sectionDomId = (key: SectionKey): string => `brief-${key.replaceAll('_', '-')}`;

export interface SheetMasthead {
  matterTitle: string;
  caseNo: string | null;
  matterHref: string;
  /** ISO date the listing is on, when known. */
  listDate: string | null;
}

export interface SheetViewModel {
  workspaceId: string;
  slug: string;
  brief: Brief;
  readiness: Readiness;
  masthead: SheetMasthead;
  /** Member names by id, for 'Prepared by'. */
  members: Record<string, string>;
  canWrite: boolean;
  /** The member's remembered choice to print private court notes. */
  printNotes: boolean;
  /** Set when a refresh cleared the mark (`brief.stale`): the note is shown once. */
  staleCleared: boolean;
  /** ISO time the page was assembled, for the offline banner. */
  assembledAt: string;
}

/** The sections that have something to show, in order. Court notes only when the payload has them. */
export function visibleSections(brief: Brief): SectionKey[] {
  return SECTION_ORDER.filter((key) => key !== 'court_notes' || brief.court_notes !== null);
}

/** The brief is empty when nothing is on record for the listing. */
export function isEmptyBrief(brief: Brief): boolean {
  return (
    brief.stage === null &&
    brief.last_order.length === 0 &&
    brief.obligations.open.length === 0 &&
    brief.obligations.closed_count === 0 &&
    brief.carry.length === 0 &&
    brief.synopsis === null &&
    brief.last_hearing === null
  );
}

/** `Brief - <case no.> - <date>`, the document title the printout and the saved PDF carry. */
export function printTitle(
  template: (v: { caseNo: string; date: string }) => string,
  m: SheetMasthead,
  today: string,
) {
  return template({ caseNo: m.caseNo ?? m.matterTitle, date: m.listDate ?? today });
}

/**
 * Whether to show the 'Brief changed since you marked it prepared' note: the mark was cleared by a
 * refresh and no new mark has been made since.
 */
export function showStaleNote(staleCleared: boolean, prepared: Brief['prepared']): boolean {
  return staleCleared && prepared === null;
}
