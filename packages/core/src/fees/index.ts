// The fees domain (#83, part 3 of 5; ADR 0048): fee agreements, invoices and the client ledger,
// behind the legal-gated `invoices.enabled` flag (`FeesDisabledError` while off) and the
// advocate-level `fee.*` actions (owners and advocates only). It records money and never moves it:
// no transport, no payment SDK. Automation-origin agreements are L2 `fee_entry` proposals. Not
// re-exported from the package root. See docs/engineering/core-domains.md.
export {
  createFeeAgreement,
  getFeeAgreement,
  listFeeAgreements,
  setFeeAgreementStatus,
  updateFeeAgreement,
  type FeeAgreementCreated,
  type FeeAgreementView,
} from './agreements.ts';
export {
  createDraftInvoice,
  discardDraftInvoice,
  getInvoice,
  isGstUnreviewed,
  issueCreditNote,
  issueInvoice,
  listInvoices,
  prepareFeeInvoice,
  recordPayment,
  updateDraftInvoice,
  type FeeInvoiceLineRow,
  type FeeInvoiceRow,
  type FeeInvoiceView,
  type FeePreview,
} from './invoices.ts';
export {
  getClientBalance,
  listLedger,
  recordClientExpense,
  recordClientReceipt,
  type LedgerEntryView,
} from './ledger.ts';
export { anonymiseClientLedger } from './anonymise.ts';
export { FeesDisabledError } from './errors.ts';
export { FEES_FLAG, type FeesActor, type FeesDeps } from './scope.ts';
