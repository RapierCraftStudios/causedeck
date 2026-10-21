// Config checksums (#372): `adapter_version.checksum` is the sha256 of the config's canonical JSON
// (object keys sorted at every depth, after zod defaults), so two equal configs always hash the
// same and the loader can refuse a row whose config was edited behind its checksum. Web Crypto
// only: the package entry stays free of Node built-ins (apps/web imports it).
import { AdapterConfigSchema, type AdapterConfig, type AdapterConfigInput } from './schema.ts';

/** JSON with object keys sorted recursively; arrays keep their order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

/** Hex sha256 of a UTF-8 string. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The `adapter_version.checksum` of a config: sha256 of its validated, canonical JSON. */
export function configChecksum(config: AdapterConfig | AdapterConfigInput): Promise<string> {
  return sha256Hex(canonicalJson(AdapterConfigSchema.parse(config)));
}
