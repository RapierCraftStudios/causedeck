// Recognition-based matching (#74): M7 hints rank match candidates; they never allow an auto-apply.
export {
  ALIAS_BOOST,
  ALIAS_PENALTY,
  CONFIDENT_MARGIN,
  learnFromCorrection,
  needsConfirmation,
  rankCandidates,
  rankWithMemory,
  recognitionHints,
  type MatchCandidate,
  type MatchInput,
  type ProposalLevel,
  type RankedCandidate,
  type RecognitionHint,
} from './recognition.ts';
