// The intake domain (#87, part 1 of 3; ADR 0047): the inbound enquiry log. An enquiry is a person
// asking the chamber to take work; it is logged, checked for a conflict of interest (hits for the
// advocate to weigh, never a verdict), then accepted as a matter (only through a `new_matter`
// proposal), declined, referred or closed. Everything is behind the legal-gated `intake.enquiry_log`
// flag and the advocate-level `enquiry.*` actions. Nothing here sends anything: no reply, template
// or auto-response (a static test guards that). See docs/engineering/core-domains.md.
export {
  acceptEnquiry,
  closeEnquiry,
  getEnquiry,
  listEnquiries,
  logEnquiry,
  updateEnquiry,
  type EnquiryPartyView,
  type EnquiryView,
} from './enquiry.ts';
export {
  rankHits,
  runConflictCheck,
  type EnquiryConflictCheck,
  type EnquiryConflictHit,
} from './conflict.ts';
export {
  ENQUIRY_RETENTION_BATCH,
  ENQUIRY_RETENTION_DEFAULT_MONTHS,
  enquiryRetentionTargets,
  retentionCutoff,
  sweepClosedEnquiries,
} from './retention.ts';
export { FeatureDisabledError } from './errors.ts';
export { ENQUIRY_LOG_FLAG, type IntakeActor, type IntakeDeps } from './scope.ts';
