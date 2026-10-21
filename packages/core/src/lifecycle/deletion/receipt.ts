// Workspace deletion receipt (#302; docs/engineering/data-lifecycle.md). The proof that a workspace
// was erased, kept on `deletion_tombstone` (`receipt`, `receipt_hash`) and emailed to the requesting
// owner before the final step. It holds no content: hashes of the workspace and job ids, the time of
// each erase step, counts, and the workspace audit chain's head hash (the hash chain reference)
// captured before the chain is purged. It is HMAC-SHA256 signed with a key derived from the server
// secret (label `causedeck:deletion-receipt:v1`), like the export download links.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const DELETION_RECEIPT_VERSION = 1;

const LABEL = 'causedeck:deletion-receipt:v1';

/** Times of one erase step (ISO 8601). */
export interface ReceiptStep {
  startedAt: string;
  doneAt: string;
}

export interface DeletionReceiptBody {
  v: typeof DELETION_RECEIPT_VERSION;
  /** sha256 hex of the label and the workspace id: proves which workspace without naming it. */
  workspaceIdHash: string;
  jobIdHash: string;
  requestedAt: string;
  cooloffUntil: string | null;
  steps: {
    revoke: ReceiptStep;
    dek: ReceiptStep;
    blobs: ReceiptStep;
    rows: ReceiptStep;
    receipt: { startedAt: string };
  };
  /** Head hash (hex) of the workspace audit chain before it was purged; null for an empty chain. */
  auditChainHead: string | null;
  counts: { blobs: number; rows: number; legalHoldInvoices: number };
}

export interface DeletionReceipt extends DeletionReceiptBody {
  /** base64url HMAC-SHA256 over the canonical JSON of the body. */
  signature: string;
}

export interface BuildReceiptInput {
  workspaceId: string;
  jobId: string;
  requestedAt: Date;
  cooloffUntil: Date | null;
  steps: DeletionReceiptBody['steps'];
  auditChainHead: string | null;
  counts: DeletionReceiptBody['counts'];
}

/** JSON with object keys sorted at every depth, so equal receipts serialise identically. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const idHash = (kind: string, id: string) =>
  createHash('sha256').update(`${LABEL}:${kind}:${id.toLowerCase()}`).digest('hex');

/** The hash a receipt records for a workspace id (the tombstone keeps the id itself). */
export const receiptWorkspaceIdHash = (workspaceId: string) => idHash('workspace', workspaceId);

const receiptKey = (secret: string) => createHmac('sha256', secret).update(LABEL).digest();

const sign = (body: DeletionReceiptBody, secret: string) =>
  createHmac('sha256', receiptKey(secret)).update(canonicalJson(body)).digest('base64url');

/** Build and sign the receipt for an erased workspace. */
export function buildDeletionReceipt(input: BuildReceiptInput, secret: string): DeletionReceipt {
  const body: DeletionReceiptBody = {
    v: DELETION_RECEIPT_VERSION,
    workspaceIdHash: receiptWorkspaceIdHash(input.workspaceId),
    jobIdHash: idHash('job', input.jobId),
    requestedAt: input.requestedAt.toISOString(),
    cooloffUntil: input.cooloffUntil?.toISOString() ?? null,
    steps: input.steps,
    auditChainHead: input.auditChainHead,
    counts: input.counts,
  };
  return { ...body, signature: sign(body, secret) };
}

/** sha256 hex of the receipt's canonical JSON (signature included): `deletion_tombstone.receipt_hash`. */
export function receiptHash(receipt: DeletionReceipt): string {
  return createHash('sha256').update(canonicalJson(receipt)).digest('hex');
}

/** True when `receipt` carries a valid signature under `secret`. */
export function verifyDeletionReceipt(receipt: DeletionReceipt, secret: string): boolean {
  const { signature, ...body } = receipt;
  if (typeof signature !== 'string') return false;
  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
