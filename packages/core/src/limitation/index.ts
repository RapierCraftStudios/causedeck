// The limitation domain (#84, part 2; #940; ADR 0049): rule table loading, the pure date engine and
// the compute / confirm flow. Behind the legal-gated `limitation.enabled` flag
// (`FeatureDisabledError` while off). A date is computed only from a counsel-reviewed rule
// (`NoReviewedRuleError` otherwise); an imported table is an unreviewed draft. Owners and
// advocates compute and confirm; a clerk or viewer sees due dates only. Nothing here imports
// `@causedeck/ai`: a static test guards it. See docs/engineering/core-domains.md.
export { addDays, addMonths, computeExpiry } from './engine.ts';
export { FeatureDisabledError, NoReviewedRuleError } from './errors.ts';
export { listRules, loadRuleTable, type RuleView } from './rules.ts';
export {
  computeLimitation,
  confirmLimitation,
  listLimitations,
  type ComputationView,
} from './propose.ts';
export type { LimitationActor, LimitationDeps } from './scope.ts';
