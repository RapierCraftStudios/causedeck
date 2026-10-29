import type { ConflictCheckView } from '../../../../../../../lib/intake/intake-deps.ts';
import type { Result } from '../../../../../../../lib/safe-action.ts';

/** The enquiry server actions the client components call (injected by the page). */
export interface EnquiryActions {
  log: (input: unknown) => Promise<Result<{ id: string; status: string }>>;
  update: (input: unknown) => Promise<Result<{ id: string; status: string }>>;
  check: (input: unknown) => Promise<Result<ConflictCheckView>>;
  accept: (input: unknown) => Promise<Result<{ id: string; status: string }>>;
  close: (input: unknown) => Promise<Result<{ id: string; status: string }>>;
}

export type EnquiryErrorKey = 'forbidden' | 'invalid' | 'conflict' | 'failed';

/** The translation key for a failed action; the server's message never reaches the screen. */
export function enquiryErrorKey(code: string): EnquiryErrorKey {
  if (code === 'FORBIDDEN' || code === 'NOT_FOUND') return 'forbidden';
  if (code === 'VALIDATION') return 'invalid';
  if (code === 'CONFLICT') return 'conflict';
  return 'failed';
}
