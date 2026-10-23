// The calendar domain (#53, ADR 0024): the private ICS feed (token lifecycle and the unauthenticated
// serve path) and the ICS import (the `capture.process` body for channel `ics` and its review).
// Pure parsing, detection and rendering live in `@causedeck/capture` (`ics/`); this domain adds the
// workspace scope, policy checks and the graph and automation services. Nothing here sends a
// message: the feed is read-only and an import never confirms a date by itself. See
// docs/engineering/core-domains.md.
export {
  CALENDAR_DISCLOSURE_VERSION,
  createFeed,
  getFeedStatus,
  revokeFeed,
  rotateFeed,
  setFeedIncludeParties,
  type CreateFeedRequest,
  type FeedRequestBase,
  type FeedStatus,
  type FeedWithToken,
} from './feed.ts';
export {
  describeImport,
  runIcsImport,
  type IcsImportDeps,
  type IcsImportOutcome,
  type IcsImportSummary,
} from './import.ts';
export {
  attachImportEventAsNote,
  confirmImportEvent,
  getImportReview,
  skipImportEvent,
  type ImportPreview,
  type ImportReview,
  type ImportReviewRow,
  type ReviewScope,
} from './review.ts';
export {
  etagMatches,
  FEED_RATE_LIMIT,
  serveFeed,
  type ServeDeps,
  type ServeResult,
} from './serve.ts';
