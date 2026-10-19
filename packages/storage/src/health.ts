// Storage readiness (#13 health seam): head-bucket through the store's `ping()`.
import type { ObjectStore } from './provider.ts';

/** A `HealthCheck` for `createHealthHandlers`; rejects when the bucket is unreachable. */
export function storageReadyCheck(store: Pick<ObjectStore, 'ping'>): () => Promise<void> {
  return () => store.ping();
}
