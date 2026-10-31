// The research domain (#497, D-048): per-matter issue tags and judgment alerts. A new corpus
// judgment that cites a statute section confirmed on a matter alerts the advocates who may read it;
// a citation is shown only if `verifyCitation` resolves it (D-004).
export {
  addTag,
  confirmTag,
  dismissTag,
  listRelevantJudgments,
  listTags,
  proposeTags,
  scanJudgments,
  type IssueTagRow,
  type RelevantJudgment,
  type ResearchActor,
  type ScanDeps,
  type ScanReport,
} from './alerts.ts';
// Research link-outs, notes and workspace provider templates (#80, D-048): links are built from
// matter facts the actor can see and opened in a new window; notes need `memory.read`/`memory.write`.
export { buildResearchLinks, researchQueryParts, type ResearchFacts, type ResearchLink } from './links.ts';
export {
  BUILT_IN_PROVIDERS,
  QUERY_PLACEHOLDER,
  providerFromTemplate,
  validateProviderTemplate,
  type ResearchProvider,
  type TemplateCheck,
} from './providers.ts';
export {
  addAuthority,
  createNote,
  deleteNote,
  getResearchFacts,
  listLinkProviders,
  listNotes,
  listProviderTemplates,
  removeAuthority,
  removeProviderTemplate,
  researchFactsFromTags,
  saveProviderTemplate,
  setAuthorityPinned,
  updateNote,
  type ProviderTemplateRow,
  type ResearchNoteRow,
} from './notes-service.ts';
// Fact-pattern search over the judgment corpus (#896, ADR 0051): plan, retrieve, fuse, rerank, group
// and a verified answer, metered per workspace and audited as ids.
export {
  rerunAuthoritySearch,
  RESEARCH_QUERY_MAX_CHARS,
  RESEARCH_SEARCH_CAPS,
  RESEARCH_SEARCH_KEY,
  RESEARCH_SUBJECT_AREAS,
  searchAuthorities,
  type AuthoritySearchResult,
  type ResearchRerunInput,
  type ResearchSearchActor,
  type ResearchSearchDeps,
  type ResearchSearchInput,
  type ResearchUsage,
} from './search.ts';
