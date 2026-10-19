// Per-kind upload size caps (#21, spike #1 §6). Sizes are binary megabytes (MiB): 50 MB means
// 50 × 1024 × 1024 bytes.

/** The object kinds a key may carry; also the third key segment. */
export const OBJECT_KINDS = ['document', 'audio', 'image', 'zip'] as const;

export type ObjectKind = (typeof OBJECT_KINDS)[number];

const MB = 1024 * 1024;

export const MAX_OBJECT_BYTES: Readonly<Record<ObjectKind, number>> = Object.freeze({
  document: 50 * MB,
  audio: 100 * MB,
  image: 25 * MB,
  zip: 200 * MB,
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
  return (OBJECT_KINDS as readonly string[]).includes(value);
}

/** Throws unless `bytes` is a non-negative integer within the cap for `kind`. */
export function assertWithinLimit(kind: ObjectKind, bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new RangeError('object size must be a non-negative integer');
  }
  if (bytes > MAX_OBJECT_BYTES[kind]) throw new ObjectTooLargeError(kind, bytes);
}
