// The conflict-of-interest domain (#500, D-048): name matching across the chamber's own matters and
// parties, behind the legal-gated `conflicts.check` flag. It never blocks; the advocate decides.
export {
  checkConflicts,
  type ConflictActor,
  type ConflictCheckResult,
  type ConflictHit,
  type ConflictPartyInput,
  type ConflictSide,
} from './check.ts';
export { nameKey, nameSimilarity, nameTokens, transliterate } from './normalize.ts';
