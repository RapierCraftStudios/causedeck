// The statutes domain (#1125, part 3 of #1116; D-053, ADR 0051): a section's text and history, a
// heading search and the judgments that cite it. `CODE_MAP` is the only correspondence table;
// titles are masked and nothing is audited or logged.
export {
  getSection,
  listSectionHistory,
  resolveSectionRef,
  searchSections,
  STATUTE_QUERY_MAX_CHARS,
  STATUTE_RESULT_MAX,
  topAuthoritiesForSection,
  type SectionAuthority,
  type SectionHistoryView,
  type SectionHit,
  type SectionRef,
  type SectionRefMatch,
  type SectionVersionView,
  type SectionView,
  type StatuteActView,
  type StatutesActor,
} from './service.ts';
