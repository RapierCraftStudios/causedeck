// The capture allow-list (#43; spike §6 Uploads). Capture decides a file's type from its
// extension, its declared MIME and its magic bytes together, never from the client-sent
// `Content-Type` alone: the entry comes from `@causedeck/storage`'s allow-list (so capture and
// `/api/uploads` cannot disagree) and the sniffed bytes must be a type that entry accepts. Nothing
// here opens or renders a document; sniffing reads magic bytes only.
import {
  ALLOWED_TYPES,
  findAllowedType,
  isCompatible,
  sniffMime,
  storedMime,
  type AllowedType,
} from '@causedeck/storage';

const KINDS = ['document', 'image', 'audio', 'zip'] as const;

/** `UnsupportedTypeError.reason`: why a file was refused. */
export type UnsupportedTypeReason = 'not_allowed' | 'content_mismatch';

export class UnsupportedTypeError extends Error {
  override name = 'UnsupportedTypeError';

  constructor(readonly reason: UnsupportedTypeReason) {
    super(
      reason === 'not_allowed'
        ? 'this file type is not supported'
        : 'the file content does not match its type',
    );
  }
}

export function isUnsupportedTypeError(error: unknown): error is UnsupportedTypeError {
  return error instanceof UnsupportedTypeError;
}

export class CaptureTooLargeError extends Error {
  override name = 'CaptureTooLargeError';

  constructor(
    readonly type: string,
    readonly capBytes: number,
  ) {
    super(`${type} captures are limited to ${String(capBytes)} bytes`);
  }
}

const MB = 1024 * 1024;

/** Default size caps by allow-list entry name (issue #43). Config overrides them. */
export const DEFAULT_SIZE_CAPS_BYTES: Readonly<Record<string, number>> = Object.freeze({
  pdf: 50 * MB,
  docx: 25 * MB,
  ics: 1 * MB,
  txt: 5 * MB,
  eml: 25 * MB,
  html: 5 * MB,
  png: 20 * MB,
  jpeg: 20 * MB,
  webp: 20 * MB,
  heic: 20 * MB,
  m4a: 25 * MB,
  mp3: 25 * MB,
  wav: 25 * MB,
  ogg: 25 * MB,
  webm: 25 * MB,
  zip: 100 * MB,
});

/** The size cap for an allow-list entry, with optional per-name overrides. */
export function sizeCapBytes(
  type: Pick<AllowedType, 'name'>,
  overrides: Readonly<Record<string, number>> = {},
): number {
  return overrides[type.name] ?? DEFAULT_SIZE_CAPS_BYTES[type.name] ?? 0;
}

/** Throws `CaptureTooLargeError` unless `bytes` is within the cap for the type. */
export function assertWithinCap(
  type: Pick<AllowedType, 'name'>,
  bytes: number,
  overrides: Readonly<Record<string, number>> = {},
): void {
  const cap = sizeCapBytes(type, overrides);
  if (bytes > cap) throw new CaptureTooLargeError(type.name, cap);
}

/** The allow-list entry for a filename and declared MIME, or `UnsupportedTypeError`. */
export function resolveAllowedType(filename: string, declaredMime: string): AllowedType {
  for (const kind of KINDS) {
    const entry = findAllowedType(kind, filename, declaredMime);
    if (entry !== null) return entry;
  }
  throw new UnsupportedTypeError('not_allowed');
}

/** Throws `UnsupportedTypeError('content_mismatch')` unless the bytes are what the entry says. */
export async function assertBytesMatch(type: AllowedType, bytes: Uint8Array): Promise<string> {
  const sniffed = await sniffMime(bytes);
  if (!isCompatible(type, sniffed)) throw new UnsupportedTypeError('content_mismatch');
  return storedMime(type, sniffed);
}

export { ALLOWED_TYPES };
