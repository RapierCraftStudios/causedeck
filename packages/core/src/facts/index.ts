// The cross-checked facts domain (#499, D-026): source agreement and confidence per fact, and the
// conflict rate per source that feeds adapter health.
export {
  UNKNOWN_CONFIDENCE,
  assessAgreement,
  getNextDateAgreement,
  getStageAgreement,
  type Agreement,
  type AgreementSource,
  type AgreementStatus,
  type FactObservation,
} from './agreement.ts';
