// Live fact-check (#913, #170): claim extraction and verdicts against the matter record. It labels
// what the author wrote; nothing here writes, repairs or proposes a claim, an authority or a merit.
export {
  caseValue,
  createClaimIndex,
  extractClaims,
  extractWithPort,
  normalizeDigits,
  toPaise,
  type BlockText,
} from './extract';
export { verify, type VerifyOptions } from './verify';
export {
  NO_MATTER_FACTS,
  type Claim,
  type ClaimKind,
  type ClaimPort,
  type ClaimPortRequest,
  type ClaimVerdict,
  type CourtRefKind,
  type FactStatus,
  type MatterAmount,
  type MatterCnr,
  type MatterCourtRef,
  type MatterDate,
  type MatterFacts,
  type MatterParty,
  type MatterProceeding,
  type PartyRoleName,
  type PortClaim,
  type SourceAnchor,
} from './types';
