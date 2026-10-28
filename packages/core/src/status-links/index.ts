// Client status links (#88, ADR 0050): advocate-authored, expiring, revocable links, behind the
// legal-gated `status_links.enabled` flag (`FeatureDisabledError` while off). Sends nothing. Not
// re-exported from the package root.
export {
  FeatureDisabledError,
  STATUS_LINKS_FLAG,
  createStatusLink,
  extendStatusLink,
  generateStatusLinkToken,
  hashStatusLinkToken,
  listStatusLinks,
  prefillFromDraft,
  revokeStatusLink,
  type CreatedStatusLink,
  type StatusLinkActor,
  type StatusLinkDeps,
  type StatusLinkRow,
} from './create.ts';
export {
  STATUS_LINK_RATE_LIMIT,
  classifyUserAgent,
  resolveStatusLink,
  type ResolveDeps,
  type ResolvedStatusLink,
} from './resolve.ts';
export {
  STATUS_LINK_PURGE_DAYS,
  purgeExpiredStatusLinks,
  statusLinkPurgeTargets,
} from './retention.ts';
