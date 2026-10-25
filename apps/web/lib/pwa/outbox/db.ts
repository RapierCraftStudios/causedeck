// The outbox's IndexedDB schema (#50, Dexie). Captures shared or recorded while offline wait here,
// encrypted, until they upload. This is the only module that imports Dexie, so the service worker
// and the outbox routes load it on demand and the shell never pays for it. Everything else works
// against the small `OutboxStore` / `KeyStore` interfaces below, which tests replace with memory.
import Dexie, { type EntityTable } from 'dexie';

export type OutboxState = 'queued' | 'uploading' | 'failed' | 'sent';

export interface OutboxItem {
  id: string;
  /** Files of one share (or one pick) share a batch, shown on `/share-target?batch=<id>`. */
  batchId: string;
  /** `null` until the person picks one (several workspaces) or signs in. */
  workspaceId: string | null;
  channel: 'share' | 'upload' | 'camera' | 'voice';
  name: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: number;
  state: OutboxState;
  attempts: number;
  lastError: string | null;
  /** AES-GCM ciphertext; empty once the item is `sent`. */
  encryptedBlob: ArrayBuffer;
  iv: Uint8Array<ArrayBuffer>;
  matterHintId?: string | undefined;
  /** Set after a successful presign, so a retry after the PUT goes straight to `complete`. */
  captureId?: string | undefined;
  putDone?: boolean | undefined;
  /**
   * A camera page waiting for its batch to be finished (#52): stored encrypted at once, never
   * uploaded on its own. Finishing the batch replaces its held pages with one multi-page item.
   */
  hold?: boolean | undefined;
  /** Epoch ms before which the sync loop leaves a failed attempt alone (backoff). */
  nextAttemptAt?: number | undefined;
}

export interface OutboxStore {
  all(): Promise<OutboxItem[]>;
  get(id: string): Promise<OutboxItem | undefined>;
  put(item: OutboxItem): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Holds the device's non-extractable AES key (a `CryptoKey` survives structured clone). */
export interface KeyStore {
  get(): Promise<CryptoKey | undefined>;
  put(key: CryptoKey): Promise<void>;
}

interface KeyRow {
  id: 'device';
  key: CryptoKey;
}

class OutboxDb extends Dexie {
  items!: EntityTable<OutboxItem, 'id'>;
  keys!: EntityTable<KeyRow, 'id'>;

  constructor() {
    super('causedeck-outbox');
    this.version(1).stores({
      items: 'id, batchId, state, workspaceId, createdAt',
      keys: 'id',
    });
  }
}

let db: OutboxDb | undefined;

function open(): OutboxDb {
  db ??= new OutboxDb();
  return db;
}

export function dexieOutboxStore(): OutboxStore {
  const { items } = open();
  return {
    all: () => items.orderBy('createdAt').toArray(),
    get: (id) => items.get(id),
    put: async (item) => {
      await items.put(item);
    },
    remove: (id) => items.delete(id),
  };
}

export function dexieKeyStore(): KeyStore {
  const { keys } = open();
  return {
    get: async () => (await keys.get('device'))?.key,
    put: async (key) => {
      await keys.put({ id: 'device', key });
    },
  };
}
