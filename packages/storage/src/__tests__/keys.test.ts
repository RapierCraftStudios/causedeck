import { describe, expect, it } from 'vitest';

import {
  corpusObjectKey,
  InvalidObjectKeyError,
  isObjectKey,
  objectKey,
  parseObjectKey,
  publicObjectKey,
  workspacePrefix,
} from '../keys.ts';
import { createMemoryObjectStore } from '../memory-provider.ts';

const WS = '0b7f4c1e-8d2a-4f3b-9c6d-1a2b3c4d5e6f';
const ID = '6f1e2d3c-4b5a-4968-8776-655443322110';
const AT = new Date('2026-10-19T12:00:00Z');

describe('objectKey', () => {
  it('builds ws/<workspaceId>/<kind>/<yyyy>/<id> from validated parts', () => {
    expect(objectKey({ workspaceId: WS, kind: 'document', id: ID }, AT)).toBe(
      `ws/${WS}/document/2026/${ID}`,
    );
    expect(objectKey({ workspaceId: WS, kind: 'audio', id: ID, version: 3 }, AT)).toBe(
      `ws/${WS}/audio/2026/${ID}.v3`,
    );
  });

  it('takes the year in UTC', () => {
    const key = objectKey(
      { workspaceId: WS, kind: 'image', id: ID },
      new Date('2026-12-31T23:30:00-05:00'),
    );
    expect(key).toBe(`ws/${WS}/image/2027/${ID}`);
  });

  it.each([
    ['traversal in the workspace id', { workspaceId: '../other', kind: 'document', id: ID }],
    ['a path as the workspace id', { workspaceId: `${WS}/../${WS}`, kind: 'document', id: ID }],
    ['traversal in the id', { workspaceId: WS, kind: 'document', id: '../../etc/passwd' }],
    ['a client path as the id', { workspaceId: WS, kind: 'document', id: `x/${ID}` }],
    ['an uppercase uuid', { workspaceId: WS.toUpperCase(), kind: 'document', id: ID }],
    ['a braced uuid', { workspaceId: `{${WS}}`, kind: 'document', id: ID }],
    ['the nil uuid', { workspaceId: '00000000-0000-0000-0000-000000000000', kind: 'zip', id: ID }],
    [
      'a uuid with a bad variant',
      { workspaceId: WS, kind: 'zip', id: ID.replace('-8776-', '-c776-') },
    ],
    ['a uuid with trailing data', { workspaceId: WS, kind: 'zip', id: `${ID}\n` }],
    ['an unknown kind', { workspaceId: WS, kind: 'secrets', id: ID }],
    ['a kind with a slash', { workspaceId: WS, kind: 'document/..', id: ID }],
    ['version 0', { workspaceId: WS, kind: 'document', id: ID, version: 0 }],
    ['a fractional version', { workspaceId: WS, kind: 'document', id: ID, version: 1.5 }],
  ])('rejects %s', (_name, parts) => {
    expect(() => objectKey(parts as Parameters<typeof objectKey>[0], AT)).toThrow(
      InvalidObjectKeyError,
    );
  });
});

describe('parseObjectKey', () => {
  it('round-trips a generated key', () => {
    const key = objectKey({ workspaceId: WS, kind: 'zip', id: ID, version: 12 }, AT);
    expect(parseObjectKey(key)).toEqual({
      key,
      workspaceId: WS,
      kind: 'zip',
      year: 2026,
      id: ID,
      version: 12,
    });
  });

  it.each([
    `ws/${WS}/document/2026/${ID}/../../${ID}`,
    `ws/${WS}/../${WS}/document/2026/${ID}`,
    `/ws/${WS}/document/2026/${ID}`,
    `ws/${WS}/document/2026/${ID}/`,
    `ws/${WS}//document/2026/${ID}`,
    `ws/${WS}/document/2026/%2e%2e%2f${ID}`,
    `ws\\${WS}\\document\\2026\\${ID}`,
    `ws/${WS}/document/26/${ID}`,
    `ws/${WS}/document/2026/${ID}.v0`,
    `ws/${WS}/document/2026/${ID}.exe`,
    `ws/${WS.toUpperCase()}/document/2026/${ID}`,
    `tenant/${WS}/document/2026/${ID}`,
    `ws/${WS}/other/2026/${ID}`,
    `ws/${WS}/document/2026`,
    '',
  ])('rejects %j', (raw) => {
    expect(() => parseObjectKey(raw)).toThrow(InvalidObjectKeyError);
    expect(isObjectKey(raw)).toBe(false);
  });
});

describe('workspacePrefix', () => {
  it('is ws/<workspaceId>/ for a valid id only', () => {
    expect(workspacePrefix(WS)).toBe(`ws/${WS}/`);
    expect(() => workspacePrefix('')).toThrow(InvalidObjectKeyError);
    expect(() => workspacePrefix('..')).toThrow(InvalidObjectKeyError);
  });
});

describe('publicObjectKey (#769)', () => {
  it('names only the allowlisted public path, which a store can write and read back', async () => {
    const key = publicObjectKey('status/status.json');
    expect(key).toBe('status/status.json');
    const store = createMemoryObjectStore();
    await store.put({ key, body: new TextEncoder().encode('{}'), contentType: 'application/json' });
    expect(new TextDecoder().decode((await store.get(key)).body)).toBe('{}');
  });

  it.each([
    'status/other.json',
    '../status/status.json',
    'status/status.json/',
    'ws/x/status.json',
  ])('does not widen parseObjectKey to %j', (raw) => {
    expect(() => publicObjectKey(raw as 'status/status.json')).toThrow(InvalidObjectKeyError);
    expect(() => parseObjectKey(raw)).toThrow(InvalidObjectKeyError);
  });
});

describe('corpus object keys (#890)', () => {
  it('accepts only corpus/<sha256>.pdf', async () => {
    const sha = 'a'.repeat(64);
    const key = corpusObjectKey(sha);
    expect(parseObjectKey(key).key).toBe(key);
    const store = createMemoryObjectStore();
    await store.put({ key, body: new Uint8Array([1]), contentType: 'application/pdf' });
    expect(() => corpusObjectKey('abc')).toThrow(InvalidObjectKeyError);
    expect(() => parseObjectKey('corpus/../x.pdf')).toThrow(InvalidObjectKeyError);
  });
});
