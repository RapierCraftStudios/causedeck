// Fixtures for the capture domain tests (#43): a context over the test transaction with an
// in-memory object store and job spies, small real-looking files, and the "client upload" step.
import { createHash, randomUUID } from 'node:crypto';

import { captureConfigFromEnv, type CaptureConfig } from '@causedeck/capture';
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace } from '@causedeck/db/testing';
import {
  createMemoryObjectStore,
  type MemoryObjectStore,
  type ObjectKey,
} from '@causedeck/storage';
import { eq } from 'drizzle-orm';

import type { CaptureAction, CaptureCtx } from '../context.ts';

export const PDF = new Uint8Array(
  Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'),
);
export const PDF_B = new Uint8Array(
  Buffer.from('%PDF-1.7\n2 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'),
);
export const PNG = new Uint8Array(
  Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(256)]),
);
export const WEBM = new Uint8Array(
  Buffer.concat([
    Buffer.from('1a45dfa39f4286810142f7810142f2810442f381084282847765626d', 'hex'),
    Buffer.alloc(256),
  ]),
);

export const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

export const NOW = new Date('2026-10-19T10:00:00Z');

export class Denied extends Error {
  readonly code = 'FORBIDDEN';
}

export interface Harness {
  ctx: CaptureCtx;
  store: MemoryObjectStore;
  scans: unknown[];
  processes: unknown[];
  /** Actions the caller may take. */
  allow: Set<CaptureAction>;
}

export function harness(
  tx: Transaction,
  workspaceId: string,
  userId: string,
  options: { env?: Record<string, string>; config?: CaptureConfig; store?: MemoryObjectStore } = {},
): Harness {
  const store = options.store ?? createMemoryObjectStore();
  const scans: unknown[] = [];
  const processes: unknown[] = [];
  const allow = new Set<CaptureAction>(['document.read', 'document.write', 'workspace.manage']);
  const ctx: CaptureCtx = {
    db: tx,
    store,
    workspaceId,
    userId,
    authorize: (action) => {
      if (!allow.has(action)) throw new Denied(action);
    },
    config: options.config ?? captureConfigFromEnv(options.env ?? {}),
    jobs: {
      scan: (payload) => Promise.resolve(scans.push(payload)),
      process: (payload) => Promise.resolve(processes.push(payload)),
    },
    now: () => NOW,
  };
  return { ctx, store, scans, processes, allow };
}

/** The "client" PUT of a presigned upload: write the bytes at the capture's raw key. */
export async function putRaw(
  tx: Transaction,
  h: Harness,
  captureId: string,
  bytes: Uint8Array,
  contentType = 'application/pdf',
): Promise<ObjectKey> {
  const row = await readCapture(tx, h.ctx.workspaceId, captureId);
  if (row.rawStorageKey === null) throw new Error('capture has no raw key');
  const key = row.rawStorageKey as ObjectKey;
  await h.store.put({ key, body: bytes, contentType });
  return key;
}

export async function readCapture(tx: Transaction, workspaceId: string, captureId: string) {
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s.select().from(schema.capture).where(eq(schema.capture.id, captureId)),
  );
  if (row === undefined) throw new Error('capture not found');
  return row;
}

export async function newMatter(
  tx: Transaction,
  workspaceId: string,
  sensitive: boolean,
): Promise<string> {
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.matter)
      .values({ workspaceId, title: `Capture test ${randomUUID().slice(0, 8)}`, sensitive })
      .returning({ id: schema.matter.id }),
  );
  if (row === undefined) throw new Error('matter insert failed');
  return row.id;
}

export async function auditActions(tx: Transaction, workspaceId: string): Promise<string[]> {
  const rows = await inWorkspace(tx, workspaceId, (s) =>
    s.select({ action: schema.auditEvent.action }).from(schema.auditEvent),
  );
  return rows.map((row) => row.action);
}
