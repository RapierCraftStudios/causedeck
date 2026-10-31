// Server-side object keys (#21): `ws/<workspaceId>/<kind>/<yyyy>/<id>[.v<n>]`. Keys are only ever
// built from validated parts or parsed strictly; a client-supplied path is never used as a key.
import { isObjectKind, type ObjectKind } from './limits.ts';

declare const objectKeyBrand: unique symbol;

/** A key produced by `objectKey()` or `parseObjectKey()`; providers accept nothing else. */
export type ObjectKey = string & { readonly [objectKeyBrand]: true };

export interface ObjectKeyParts {
  workspaceId: string;
  kind: ObjectKind;
  id: string;
  /** Positive integer; omitted for the first version. */
  version?: number;
}

export interface ParsedObjectKey extends ObjectKeyParts {
  key: ObjectKey;
  year: number;
}

/** Canonical lowercase RFC 9562 UUID (versions 1-8); rejects nil, max and non-canonical forms. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const KEY = /^ws\/([0-9a-f-]{36})\/([a-z]+)\/(\d{4})\/([0-9a-f-]{36})(?:\.v([1-9]\d{0,8}))?$/;

export class InvalidObjectKeyError extends Error {
  override name = 'InvalidObjectKeyError';
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function assertUuid(value: string, field: string): void {
  if (!isUuid(value)) throw new InvalidObjectKeyError(`${field} must be a canonical uuid`);
}

/** `ws/<workspaceId>/`: the only prefix a workspace's objects live under. */
export function workspacePrefix(workspaceId: string): string {
  assertUuid(workspaceId, 'workspaceId');
  return `ws/${workspaceId}/`;
}

/** Build a key from validated parts. `now` sets the `<yyyy>` segment (UTC). */
export function objectKey(parts: ObjectKeyParts, now: Date = new Date()): ObjectKey {
  const { workspaceId, kind, id, version } = parts;
  assertUuid(workspaceId, 'workspaceId');
  assertUuid(id, 'id');
  if (!isObjectKind(kind)) throw new InvalidObjectKeyError('unknown object kind');
  if (
    version !== undefined &&
    (!Number.isSafeInteger(version) || version < 1 || version > 999_999_999)
  ) {
    throw new InvalidObjectKeyError('version must be a positive integer');
  }
  const year = now.getUTCFullYear();
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new InvalidObjectKeyError('invalid key date');
  }
  const suffix = version === undefined ? '' : `.v${String(version)}`;
  return `ws/${workspaceId}/${kind}/${String(year)}/${id}${suffix}` as ObjectKey;
}

/**
 * The public static objects the platform itself publishes (the status feed, #769). An exact
 * allowlist, never a pattern: no client or caller can name another public path.
 */
export const PUBLIC_OBJECT_KEYS = ['status/status.json'] as const;
export type PublicObjectKeyPath = (typeof PUBLIC_OBJECT_KEYS)[number];

/** The nil UUID stands in for "no workspace" in a parsed public key; no real workspace has it. */
const NO_WORKSPACE = '00000000-0000-0000-0000-000000000000';

/** The key of an allowlisted public object; throws `InvalidObjectKeyError` for any other path. */
export function publicObjectKey(path: PublicObjectKeyPath): ObjectKey {
  if (!(PUBLIC_OBJECT_KEYS as readonly string[]).includes(path)) {
    throw new InvalidObjectKeyError('not a public object path');
  }
  return path as ObjectKey;
}

/** The global corpus original (#890, ADR 0006): `corpus/<sha256>.pdf`, no workspace, public judgments. */
const CORPUS_KEY = /^corpus\/[0-9a-f]{64}\.pdf$/;

/** True for a corpus original's key. */
export const isCorpusObjectKey = (raw: string): boolean => CORPUS_KEY.test(raw);

/** The key of a corpus original by its content hash; throws `InvalidObjectKeyError` for a non-hash. */
export function corpusObjectKey(sha256: string): ObjectKey {
  const key = `corpus/${sha256}.pdf`;
  if (!CORPUS_KEY.test(key)) throw new InvalidObjectKeyError('not a sha256');
  return key as ObjectKey;
}

/** Parse and validate a stored key; throws `InvalidObjectKeyError` on anything else. */
export function parseObjectKey(raw: string): ParsedObjectKey {
  if (CORPUS_KEY.test(raw)) {
    return {
      key: raw as ObjectKey,
      workspaceId: NO_WORKSPACE,
      kind: 'document',
      year: 0,
      id: NO_WORKSPACE,
    };
  }
  if ((PUBLIC_OBJECT_KEYS as readonly string[]).includes(raw)) {
    // Not a workspace object: it parses with no workspace (so no workspace check ever matches it)
    // and the smallest size class, so providers can write it and nothing else changes.
    return {
      key: raw as ObjectKey,
      workspaceId: NO_WORKSPACE,
      kind: 'image',
      year: 0,
      id: NO_WORKSPACE,
    };
  }
  const match = KEY.exec(raw);
  if (!match) throw new InvalidObjectKeyError('malformed object key');
  const [, workspaceId = '', kind = '', year = '', id = '', version] = match;
  assertUuid(workspaceId, 'workspaceId');
  assertUuid(id, 'id');
  if (!isObjectKind(kind)) throw new InvalidObjectKeyError('unknown object kind');
  return {
    key: raw as ObjectKey,
    workspaceId,
    kind,
    year: Number(year),
    id,
    ...(version === undefined ? {} : { version: Number(version) }),
  };
}

export function isObjectKey(raw: string): raw is ObjectKey {
  try {
    parseObjectKey(raw);
    return true;
  } catch {
    return false;
  }
}
