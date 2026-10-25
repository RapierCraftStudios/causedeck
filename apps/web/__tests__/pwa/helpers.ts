import type { KeyStore, OutboxItem, OutboxStore } from '../../lib/pwa/outbox/db.ts';

/** An in-memory outbox: the queue and uploader run against the same interface as Dexie. */
export function memoryStore(): OutboxStore & { rows: Map<string, OutboxItem> } {
  const rows = new Map<string, OutboxItem>();
  return {
    rows,
    all: () => Promise.resolve([...rows.values()].sort((a, b) => a.createdAt - b.createdAt)),
    get: (id) => Promise.resolve(rows.get(id)),
    put: (item) => {
      rows.set(item.id, item);
      return Promise.resolve();
    },
    remove: (id) => {
      rows.delete(id);
      return Promise.resolve();
    },
  };
}

export function memoryKeyStore(): KeyStore & { saved: CryptoKey | undefined } {
  const holder: { saved: CryptoKey | undefined } = { saved: undefined };
  return {
    get saved() {
      return holder.saved;
    },
    get: () => Promise.resolve(holder.saved),
    put: (key) => {
      holder.saved = key;
      return Promise.resolve();
    },
  };
}

export function deviceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

export function file(name: string, content: string, type = 'application/pdf'): File {
  return new File([content], name, { type });
}
