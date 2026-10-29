import type { FeePreview } from '@causedeck/core/fees';

import type { Result } from '../../../../../../lib/safe-action.ts';

type Saved = Result<{ id: string; number?: string; status: string }>;

/** The fee server actions the client components call (injected by the page). */
export interface FeesActions {
  createAgreement: (input: unknown) => Promise<Saved>;
  setAgreementStatus: (input: unknown) => Promise<Saved>;
  preview: (input: unknown) => Promise<Result<FeePreview>>;
  saveDraft: (input: unknown) => Promise<Saved>;
  discardDraft: (input: unknown) => Promise<Result<{ id: string }>>;
  issue: (input: unknown) => Promise<Saved>;
  recordPayment: (input: unknown) => Promise<Saved>;
  issueCreditNote: (input: unknown) => Promise<Saved>;
  recordExpense: (input: unknown) => Promise<Saved>;
  recordReceipt: (input: unknown) => Promise<Saved>;
}

export type FeesErrorKey = 'forbidden' | 'invalid' | 'conflict' | 'failed';

/** The translation key for a failed action; the server's message never reaches the screen. */
export function feesErrorKey(code: string): FeesErrorKey {
  if (code === 'FORBIDDEN' || code === 'NOT_FOUND') return 'forbidden';
  if (code === 'VALIDATION') return 'invalid';
  if (code === 'CONFLICT') return 'conflict';
  return 'failed';
}
