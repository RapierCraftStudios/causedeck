// Per-kind upload size caps (#21, spike #1 §6). Sizes are binary megabytes (MiB): 50 MB means
// 50 × 1024 × 1024 bytes.

/** The object kinds a client may upload (upload intents and `/api/uploads`). */
export const OBJECT_KINDS = ['document', 'audio', 'image', 'zip'] as const;

/**
 * Kinds only the server writes: workspace export ZIPs (#301) and quarantined captures (#43), the
 * raw objects a virus scan flagged, moved out of their kind's prefix. They have no upload
 * allow-list entry, so an upload intent for one is refused, and `/api/uploads` only accepts
 * `OBJECT_KINDS`.
 */
export const SERVER_OBJECT_KINDS = ['export', 'quarantine'] as const;

/** Every kind a key may carry; also the third key segment. */
export type ObjectKind = (typeof OBJECT_KINDS)[number] | (typeof SERVER_OBJECT_KINDS)[number];

const ALL_KINDS: readonly string[] = [...OBJECT_KINDS, ...SERVER_OBJECT_KINDS];

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const MAX_OBJECT_BYTES: Readonly<Record<ObjectKind, number>> = Object.freeze({
  document: 50 * MB,
  audio: 100 * MB,
  image: 25 * MB,
  zip: 200 * MB,
  // Streamed in parts (`putStream`), never held in memory.
  export: 20 * GB,
  // The largest capture cap (ZIP, 100 MB) with room for the other kinds' caps.
  quarantine: 200 * MB,
});

export class ObjectTooLargeError extends Error {
  override name = 'ObjectTooLargeError';

  constructor(
    readonly kind: ObjectKind,
    readonly bytes: number,
  ) {
    super(`${kind} objects are limited to ${String(MAX_OBJECT_BYTES[kind])} bytes`);
  }
}

export function isObjectKind(value: string): value is ObjectKind {
  return ALL_KINDS.includes(value);
}

/** Throws unless `bytes` is a non-negative integer within the cap for `kind`. */
export function assertWithinLimit(kind: ObjectKind, bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new RangeError('object size must be a non-negative integer');
  }
  if (bytes > MAX_OBJECT_BYTES[kind]) throw new ObjectTooLargeError(kind, bytes);
}
