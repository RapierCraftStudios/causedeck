import { describe, expect, it } from 'vitest';

import {
  decryptBytes,
  encryptBytes,
  getDeviceKey,
  sha256Hex,
} from '../../lib/pwa/outbox/crypto.ts';

import { deviceKey, memoryKeyStore } from './helpers.ts';

const bytes = (text: string) => new TextEncoder().encode(text).buffer;

describe('outbox crypto (#50)', () => {
  it('round-trips bytes through AES-GCM', async () => {
    const key = await deviceKey();
    const sealed = await encryptBytes(key, bytes('Order dated 12.11.2026 (fictional)'));
    expect(new TextDecoder().decode(await decryptBytes(key, sealed))).toBe(
      'Order dated 12.11.2026 (fictional)',
    );
  });

  it('never stores the plaintext and uses a fresh IV each time', async () => {
    const key = await deviceKey();
    const first = await encryptBytes(key, bytes('same bytes'));
    const second = await encryptBytes(key, bytes('same bytes'));
    expect(first.iv).toHaveLength(12);
    expect(Array.from(first.iv)).not.toEqual(Array.from(second.iv));
    expect(new TextDecoder().decode(first.encryptedBlob)).not.toContain('same bytes');
  });

  it('refuses to decrypt with another key or tampered bytes', async () => {
    const sealed = await encryptBytes(await deviceKey(), bytes('secret'));
    await expect(decryptBytes(await deviceKey(), sealed)).rejects.toThrow();
    const key = await deviceKey();
    const good = await encryptBytes(key, bytes('secret'));
    const tampered = new Uint8Array(good.encryptedBlob.slice(0));
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    await expect(
      decryptBytes(key, { iv: good.iv, encryptedBlob: tampered.buffer }),
    ).rejects.toThrow();
  });

  it('creates one non-extractable device key and reuses it', async () => {
    const store = memoryKeyStore();
    const key = await getDeviceKey(store);
    expect(key.extractable).toBe(false);
    expect(store.saved).toBe(key);
    expect(await getDeviceKey(store)).toBe(key);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('hashes to lowercase hex sha256', async () => {
    expect(await sha256Hex(bytes('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
