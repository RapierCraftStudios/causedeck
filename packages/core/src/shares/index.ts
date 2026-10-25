// Brief sharing and referral (#507): an expiring, revocable link to a sanitised brief snapshot, the
// recipient's view/claim/import, and the referral credit it earns. Not re-exported from the root.
export {
  SHARE_RATE_LIMIT,
  SHARE_TTL_MS,
  createBriefShare,
  generateShareToken,
  hashShareToken,
  revokeBriefShare,
  toSnapshot,
  type CreatedShare,
  type SharedBriefSnapshot,
} from './share.ts';
export {
  claimBriefShare,
  importSharedMatter,
  viewBriefShare,
  type ClaimedShare,
  type ImportedShare,
  type ShareView,
} from './view.ts';
