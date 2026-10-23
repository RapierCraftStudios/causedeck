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
