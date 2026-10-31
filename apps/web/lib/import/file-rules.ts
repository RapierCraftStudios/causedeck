// Client-side rules of the bootstrap import drop zone (#552, #57 part 6): the 200-file cap, the
// capture allow-list (#43) and its size caps, and de-duplication by content hash. The server
// checks the same rules again at presign and complete (`@causedeck/capture` allow-list); this copy
// only spares a doomed upload, so keep it in step with `ALLOWED_TYPES` and `DEFAULT_SIZE_CAPS_BYTES`.
// Client-safe: no server imports.

export const MAX_IMPORT_FILES = 200;

const MB = 1024 * 1024;

interface ImportFileType {
  name: string;
  extensions: readonly string[];
  /** Size cap in bytes (`DEFAULT_SIZE_CAPS_BYTES` in packages/capture/src/allow-list.ts). */
  capBytes: number;
}

/** The part of the capture allow-list a bootstrap import accepts: documents and pictures. */
export const IMPORT_FILE_TYPES: readonly ImportFileType[] = [
  { name: 'pdf', extensions: ['pdf'], capBytes: 50 * MB },
  { name: 'docx', extensions: ['docx'], capBytes: 25 * MB },
  { name: 'ics', extensions: ['ics'], capBytes: 1 * MB },
  { name: 'txt', extensions: ['txt'], capBytes: 5 * MB },
  { name: 'eml', extensions: ['eml'], capBytes: 25 * MB },
  { name: 'html', extensions: ['html', 'htm'], capBytes: 5 * MB },
  { name: 'png', extensions: ['png'], capBytes: 20 * MB },
  { name: 'jpeg', extensions: ['jpg', 'jpeg'], capBytes: 20 * MB },
  { name: 'webp', extensions: ['webp'], capBytes: 20 * MB },
  { name: 'heic', extensions: ['heic', 'heif'], capBytes: 20 * MB },
];

/** The `accept` attribute of the file inputs. */
export const IMPORT_ACCEPT = IMPORT_FILE_TYPES.flatMap((type) =>
  type.extensions.map((extension) => `.${extension}`),
).join(',');

export type RejectReason = 'type' | 'size' | 'empty';

export type FileClass =
  { ok: true; type: string } | { ok: false; reason: RejectReason; type: string | null };

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

/** Whether a file is allowed by name and size. */
export function classifyFile(filename: string, sizeBytes: number): FileClass {
  const extension = extensionOf(filename);
  const type = IMPORT_FILE_TYPES.find((entry) => entry.extensions.includes(extension));
  if (type === undefined)
    return { ok: false, reason: 'type', type: extension === '' ? null : extension };
  if (sizeBytes <= 0) return { ok: false, reason: 'empty', type: type.name };
  if (sizeBytes > type.capBytes) return { ok: false, reason: 'size', type: type.name };
  return { ok: true, type: type.name };
}

export type EntryStatus =
  'hashing' | 'queued' | 'uploading' | 'uploaded' | 'failed' | 'rejected' | 'duplicate';

export interface ImportEntry {
  id: string;
  name: string;
  sizeBytes: number;
  type: string | null;
  status: EntryStatus;
  /** Why the file was rejected, or the upload failure code, for the message next to it. */
  reason?: RejectReason | UploadFailureCode;
  sha256?: string;
  captureId?: string;
}

export type UploadFailureCode =
  | 'channel_disabled'
  | 'sensitive'
  | 'too_large'
  | 'unsupported'
  | 'rate_limited'
  | 'forbidden'
  | 'offline'
  | 'failed';

/** SHA-256 of the file as 64 lowercase hex characters. */
export async function fileSha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface Admission {
  /** The entries to add, in drop order: accepted, rejected and duplicate ones. */
  added: ImportEntry[];
  /** Files beyond the cap: refused, not listed. */
  refused: number;
}

export interface Candidate {
  id: string;
  name: string;
  sizeBytes: number;
  sha256: string | null;
}

/**
 * Admit dropped files after the ones already listed. At most `MAX_IMPORT_FILES` files are listed
 * in all: the next ones are refused (counted, not listed). A file whose content hash is already
 * listed (or earlier in the same drop) is marked `duplicate` and never uploaded twice.
 */
export function admitFiles(
  existing: readonly ImportEntry[],
  incoming: readonly Candidate[],
): Admission {
  const room = Math.max(0, MAX_IMPORT_FILES - existing.length);
  const seen = new Set(
    existing.flatMap((entry) => (entry.sha256 === undefined ? [] : [entry.sha256])),
  );
  const added: ImportEntry[] = [];
  for (const candidate of incoming.slice(0, room)) {
    const verdict = classifyFile(candidate.name, candidate.sizeBytes);
    const base = { id: candidate.id, name: candidate.name, sizeBytes: candidate.sizeBytes };
    if (!verdict.ok) {
      added.push({ ...base, type: verdict.type, status: 'rejected', reason: verdict.reason });
      continue;
    }
    const hash = candidate.sha256 ?? undefined;
    const duplicate = hash !== undefined && seen.has(hash);
    if (hash !== undefined) seen.add(hash);
    added.push({
      ...base,
      type: verdict.type,
      status: duplicate ? 'duplicate' : 'queued',
      ...(hash === undefined ? {} : { sha256: hash }),
    });
  }
  return { added, refused: Math.max(0, incoming.length - room) };
}
