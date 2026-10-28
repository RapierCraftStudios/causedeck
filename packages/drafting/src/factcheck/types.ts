// Fact-check types (#913, part of #170). A claim is something a draft states that the matter record
// can confirm or contradict; a verdict labels it. Nothing here judges merits or proposes an
// authority: the only text a verdict carries is a quote from the matter record or from the draft.
import type { CitationKind, CitationReason, CitationStatus } from '@causedeck/validators/citation';

export type ClaimKind =
  'date' | 'case_number' | 'party_role' | 'amount' | 'citation' | 'cnr' | 'court_ref';

export type CourtRefKind = 'hall' | 'item' | 'court';
export type DateContext = 'order' | 'listing' | null;
export type PartyRoleName = 'petitioner' | 'respondent';

export interface Claim {
  /** `<blockKey>:<start>-<end>`, stable for the same text. */
  id: string;
  kind: ClaimKind;
  blockKey: string;
  /** `[start, end)` in the block text as written. */
  start: number;
  end: number;
  raw: string;
  /**
   * Canonical value: ISO date, `WP(MD)/1234/2024`, party name, paise as a digit string, upper-case
   * CNR without hyphens, normalised citation, or the hall/item/court number.
   */
  value: string;
  /** Set for dates that follow "order dated" (`order`) or "listed on" (`listing`). */
  context?: DateContext;
  /** Set for party-role claims: the role the draft gives the person. */
  role?: PartyRoleName | null;
  /** Set for court/hall/item references. */
  ref?: CourtRefKind;
  /** Set for citations: what the resolver needs to classify it. */
  citation?: { kind: CitationKind; titleHint?: string };
  /** Where the claim came from. */
  origin: 'rule' | 'port';
}

/** Where in the record (or the draft, when the record is silent) a verdict rests. */
export interface SourceAnchor {
  document: string;
  page: number | null;
  quote: string;
}

export interface MatterProceeding {
  /** Case type as stored, brackets allowed: `WP(MD)`, `W.P.`, `CRL.O.P.`. */
  caseType: string;
  number: string;
  year: number;
  anchor: SourceAnchor;
}
export interface MatterDate {
  iso: string;
  context: DateContext;
  anchor: SourceAnchor;
}
export interface MatterParty {
  role: PartyRoleName;
  name: string;
  anchor: SourceAnchor;
}
export interface MatterAmount {
  rupees: number;
  anchor: SourceAnchor;
}
export interface MatterCnr {
  cnr: string;
  anchor: SourceAnchor;
}
export interface MatterCourtRef {
  ref: CourtRefKind;
  value: string;
  anchor: SourceAnchor;
}

/** Plain facts from the matter record; the caller loads them, this package does no I/O. */
export interface MatterFacts {
  proceedings: readonly MatterProceeding[];
  dates: readonly MatterDate[];
  parties: readonly MatterParty[];
  amounts: readonly MatterAmount[];
  cnrs: readonly MatterCnr[];
  courtRefs: readonly MatterCourtRef[];
}

export const NO_MATTER_FACTS: MatterFacts = {
  proceedings: [],
  dates: [],
  parties: [],
  amounts: [],
  cnrs: [],
  courtRefs: [],
};

export type FactStatus = 'match' | 'mismatch' | 'unsupported' | 'unverified-citation' | 'ambiguous';

export interface ClaimVerdict {
  claim: Claim;
  status: FactStatus;
  /** Always set: the record passage the verdict rests on, or the draft's own words when none exists. */
  anchor: SourceAnchor;
  /** For `unverified-citation`: why the resolver could not confirm it. */
  reason?: CitationReason;
  citationStatus?: CitationStatus;
}

export interface PortClaim {
  kind: ClaimKind;
  start: number;
  end: number;
  value: string;
}

export interface ClaimPortRequest {
  text: string;
  /** Processing stays in India regions; always true unless the caller overrides it. */
  indiaOnly: boolean;
}

/** Optional model-backed claim finder. Injected and typed locally, as `NarrativePort` is. */
export interface ClaimPort {
  findClaims(request: ClaimPortRequest): Promise<readonly PortClaim[]>;
}
