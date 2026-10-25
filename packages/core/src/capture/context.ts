// The capture domain's call context (#43). `authorize` is the `assertCan` seam, as in
// `@causedeck/storage`; `jobs` is the producer port the runtime wires to the job registry (the
// domain never imports `jobs`). Services run inside `withWorkspace`, so FORCE row-level security
// keeps every row in its own workspace.
import type {
  CaptureConfig,
  CaptureProcessPayload,
  CaptureScanPayload,
  ScanProvider,
} from '@causedeck/capture';
import type { Queryable } from '@causedeck/db';
import type { ObjectStore } from '@causedeck/storage';

/** The policy actions the capture services check: files need `document.write` (`document.read` is storage's), channels `workspace.manage`. */
export type CaptureAction = 'document.read' | 'document.write' | 'workspace.manage';

export interface CaptureJobs {
  scan(payload: CaptureScanPayload): Promise<unknown>;
  process(payload: CaptureProcessPayload): Promise<unknown>;
}

export interface CaptureCtx {
  db: Queryable;
  store: ObjectStore;
  workspaceId: string;
  userId: string;
  authorize(action: CaptureAction): void | Promise<void>;
  config: CaptureConfig;
  jobs: CaptureJobs;
  now?: () => Date;
  /** Request metadata for audit rows. */
  requestId?: string;
  userAgent?: string;
  ip?: string;
}

/** What the worker needs to run a capture job: no user, a scanner and the producer port. */
export interface CaptureJobDeps {
  db: Queryable;
  store: ObjectStore;
  config: CaptureConfig;
  scanner: ScanProvider;
  jobs: CaptureJobs;
  now?: () => Date;
}
