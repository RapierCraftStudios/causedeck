// A0 grid corrections (#558, `@causedeck/core/corrections`): the DB-backed `CorrectionStore` and the
// eval-reuse reads and consent. The owner's `allow_eval_reuse` switch lives in `workspaces`.
export {
  createCorrectionStore,
  listDocumentCorrections,
  listForEvalExport,
  setCorrectionEvalConsent,
  type CorrectionStoreContext,
  type StoredCorrection,
} from './store.ts';
