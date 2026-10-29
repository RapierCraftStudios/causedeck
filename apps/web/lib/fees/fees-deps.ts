// Server-only seam between the fee screens and the fees services (#871, #83 part 4). The services
// take `FeesDeps` and open the actor's workspace scope themselves; the app hands them the
// transaction it already holds (`inWorkspace` here, `ctx.tx` in server actions) and never imports
// `db` (#298). The page has already checked the `invoices.enabled` flag (a dark feature is a 404),
// so a `FeesDisabledError` from core is only a backstop and reads as a denial.
import type {
  FeeAgreementView,
  FeeInvoiceRow,
  FeeInvoiceView,
  FeesDeps,
  LedgerEntryView,
} from '@causedeck/core/fees';
import type { Transaction } from '@causedeck/core/runtime';

import { logger } from '../../src/health.ts';
import type { WorkspaceContext } from '../workspace-context.ts';

/** The fees deps for a transaction the caller already opened. */
export function feesDeps(tx: Transaction): FeesDeps {
  return { db: tx };
}

export type FeesListLoad =
  | { kind: 'list'; agreements: FeeAgreementView[]; invoices: FeeInvoiceRow[] }
  | { kind: 'denied' }
  | { kind: 'error' };

export type InvoiceLoad =
  | {
      kind: 'invoice';
      invoice: FeeInvoiceView;
      ledger: LedgerEntryView[];
      /** What the client owes in paise; negative when the client is in credit. */
      balancePaise: number;
    }
  | { kind: 'notFound' }
  | { kind: 'denied' }
  | { kind: 'error' };

function codeOf(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

/** The workspace's fee agreements and invoices; a denial and a failure are results. */
export async function loadFees(context: WorkspaceContext): Promise<FeesListLoad> {
  try {
    const runtime = await import('@causedeck/core/runtime');
    const fees = await import('@causedeck/core/fees');
    const scope = { workspaceId: context.workspace.id, userId: context.user.id };
    return await runtime.inWorkspace(scope, async (tx) => {
      const deps = feesDeps(tx);
      const agreements = await fees.listFeeAgreements(deps, scope);
      const invoices = await fees.listInvoices(deps, scope);
      return { kind: 'list' as const, agreements, invoices };
    });
  } catch (error) {
    if (codeOf(error) === 'FORBIDDEN') return { kind: 'denied' };
    logger.error({ err: error }, 'fees page: could not load the fee records');
    return { kind: 'error' };
  }
}

/** One invoice with its client's ledger and balance. */
export async function loadInvoice(context: WorkspaceContext, id: string): Promise<InvoiceLoad> {
  try {
    const runtime = await import('@causedeck/core/runtime');
    const fees = await import('@causedeck/core/fees');
    const scope = { workspaceId: context.workspace.id, userId: context.user.id };
    return await runtime.inWorkspace(scope, async (tx) => {
      const deps = feesDeps(tx);
      const invoice = await fees.getInvoice(deps, scope, { invoiceId: id });
      const ledger = await fees.listLedger(deps, scope, { personId: invoice.personId });
      const balancePaise = await fees.getClientBalance(deps, scope, { personId: invoice.personId });
      return { kind: 'invoice' as const, invoice, ledger, balancePaise };
    });
  } catch (error) {
    const code = codeOf(error);
    if (code === 'FORBIDDEN') return { kind: 'denied' };
    if (code === 'NOT_FOUND') return { kind: 'notFound' };
    logger.error({ err: error }, 'fees page: could not load the invoice');
    return { kind: 'error' };
  }
}

/** One choice in a matter or client picker. */
export interface PickerOption {
  id: string;
  label: string;
}

export interface FeePickers {
  matters: PickerOption[];
  clients: PickerOption[];
  /** The stored supplier state code, or null before the first invoice. */
  supplierStateCode: string | null;
}

/** A practice past this many matters needs a search picker; the select stays usable to here. */
const PICKER_MATTER_CAP = 2000;

const NO_PICKERS: FeePickers = { matters: [], clients: [], supplierStateCode: null };

/**
 * What the forms offer: the matters and clients the actor may see, and the stored supplier state.
 * A failure is an empty picker (the form shows a hint), never a broken page: the lists are a
 * convenience and the server checks every id again.
 */
export async function loadFeePickers(context: WorkspaceContext): Promise<FeePickers> {
  try {
    const runtime = await import('@causedeck/core/runtime');
    const fees = await import('@causedeck/core/fees');
    const graph = await import('@causedeck/core/matter-graph');
    const scope = { workspaceId: context.workspace.id, userId: context.user.id };
    return await runtime.inWorkspace(scope, async (tx) => {
      // Every matter, a page of 100 at a time (the list's maximum), up to PICKER_MATTER_CAP.
      const matters: PickerOption[] = [];
      let cursor: string | undefined;
      do {
        const page = await graph.listMatters({ db: tx, events: { emit: () => undefined } }, scope, {
          limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        });
        matters.push(...page.items.map((m) => ({ id: m.id, label: m.title })));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined && matters.length < PICKER_MATTER_CAP);
      const clients = await fees.listFeeClients(feesDeps(tx), scope);
      return {
        matters,
        clients: clients.map((client) => ({ id: client.id, label: client.name })),
        supplierStateCode: await fees.getFeeSupplierState(feesDeps(tx), scope),
      };
    });
  } catch (error) {
    logger.error({ err: error }, 'fees page: could not load the matter and client pickers');
    return NO_PICKERS;
  }
}
