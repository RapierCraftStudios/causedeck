// The app's object store (#217): MinIO or AWS S3 from `STORAGE_PROVIDER` / `S3_*`, built once per
// process. `createObjectStoreFromEnv` refuses Cloudflare R2 and non-India regions. Server-only.
import { createObjectStoreFromEnv, type ObjectStore } from '@causedeck/storage';

import { serverEnv } from './env.ts';

let store: ObjectStore | undefined;

export function objectStore(): ObjectStore {
  return (store ??= createObjectStoreFromEnv(serverEnv()));
}
