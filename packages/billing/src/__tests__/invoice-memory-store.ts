// An in-memory `InvoiceStore` for the pure issuance tests (the database adapter is tested in
// `@causedeck/core`).
import type { InvoiceRecipientRecord, InvoiceStore, SaasInvoiceDraft } from '../invoice/generate';

export interface MemoryInvoice extends SaasInvoiceDraft {
  id: string;
  status: 'draft' | 'issued';
  number: string | null;
  issueDate: string | null;
}

export interface MemoryInvoiceStore extends InvoiceStore {
  recipients: Map<string, InvoiceRecipientRecord>;
  counters: Map<string, number>;
  invoices: MemoryInvoice[];
  calls: string[];
}

export function createMemoryInvoiceStore(): MemoryInvoiceStore {
  const store: MemoryInvoiceStore = {
    recipients: new Map(),
    counters: new Map(),
    invoices: [],
    calls: [],
    loadRecipient(subscriptionId) {
      store.calls.push('loadRecipient');
      const record = store.recipients.get(subscriptionId);
      return Promise.resolve(record ? { ...record } : null);
    },
    allocate(series, fy) {
      store.calls.push('allocate');
      const key = `${series}|${fy}`;
      const next = (store.counters.get(key) ?? 0) + 1;
      store.counters.set(key, next);
      return Promise.resolve(next);
    },
    insertDraft(draft) {
      store.calls.push('insertDraft');
      const id = `inv-${String(store.invoices.length + 1)}`;
      store.invoices.push({
        ...structuredClone(draft),
        id,
        status: 'draft',
        number: null,
        issueDate: null,
      });
      return Promise.resolve(id);
    },
    markIssued(id, number, issueDate) {
      store.calls.push('markIssued');
      const invoice = store.invoices.find((i) => i.id === id);
      if (!invoice) return Promise.reject(new Error(`no invoice ${id}`));
      Object.assign(invoice, { status: 'issued', number, issueDate });
      return Promise.resolve();
    },
  };
  return store;
}
