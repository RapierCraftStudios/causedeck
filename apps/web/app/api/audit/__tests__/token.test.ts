// Audit export download tokens (#229): HMAC-signed, 60 s, strict payload shape; tampering, another
// secret, expiry and malformed tokens are all rejected.
import { describe, expect, it } from 'vitest';

import {
  EXPORT_TOKEN_TTL_MS,
  signExportToken,
  verifyExportToken,
  type ExportTokenPayload,
} from '../../../../lib/audit-export-token.ts';

const SECRET = 's'.repeat(40);
const NOW = 1_800_000_000_000;
const payload: ExportTokenPayload = {
  w: '00000000-0000-4000-8000-00000000000a',
  u: '00000000-0000-4000-8000-000000000001',
  from: '2026-01-01T00:00:00.000Z',
  to: '2026-02-01T00:00:00.000Z',
  format: 'csv',
  bom: true,
  exp: NOW + EXPORT_TOKEN_TTL_MS,
};

describe('audit export token', () => {
  it('round-trips within the 60 s TTL', () => {
    expect(EXPORT_TOKEN_TTL_MS).toBe(60_000);
    const token = signExportToken(payload, SECRET, NOW);
    expect(token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(verifyExportToken(token, SECRET, NOW)).toEqual(payload);
    expect(verifyExportToken(token, SECRET, NOW + EXPORT_TOKEN_TTL_MS - 1)).toEqual(payload);
  });

  it('rejects expired tokens and refuses to sign one', () => {
    const token = signExportToken(payload, SECRET, NOW);
    expect(verifyExportToken(token, SECRET, NOW + EXPORT_TOKEN_TTL_MS)).toBeNull();
    expect(() => signExportToken({ ...payload, exp: NOW }, SECRET, NOW)).toThrow();
  });

  it('rejects another secret, a tampered body or signature, and malformed tokens', () => {
    const token = signExportToken(payload, SECRET, NOW);
    const [body, sig] = token.split('.') as [string, string];
    expect(verifyExportToken(token, 't'.repeat(40), NOW)).toBeNull();
    const forged = Buffer.from(JSON.stringify({ ...payload, w: '00000000-0000-4000-8000-00000000000b' })).toString('base64url');
    expect(verifyExportToken(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifyExportToken(`${body}.${sig.slice(0, -2)}`, SECRET, NOW)).toBeNull();
    expect(verifyExportToken(`${body}.${sig}.x`, SECRET, NOW)).toBeNull();
    expect(verifyExportToken('', SECRET, NOW)).toBeNull();
    expect(verifyExportToken('not-a-token', SECRET, NOW)).toBeNull();
  });

  it('rejects a correctly signed payload with the wrong shape', async () => {
    const { createHmac } = await import('node:crypto');
    const key = createHmac('sha256', SECRET).update('causedeck:audit-export:v1').digest();
    const sign = (value: unknown) => {
      const b = Buffer.from(JSON.stringify(value)).toString('base64url');
      return `${b}.${createHmac('sha256', key).update(b).digest('base64url')}`;
    };
    expect(verifyExportToken(sign(payload), SECRET, NOW)).toEqual(payload);
    expect(verifyExportToken(sign({ ...payload, format: 'xlsx' }), SECRET, NOW)).toBeNull();
    expect(verifyExportToken(sign({ ...payload, extra: 1 }), SECRET, NOW)).toBeNull();
    expect(verifyExportToken(sign({ ...payload, w: 'nope' }), SECRET, NOW)).toBeNull();
    expect(verifyExportToken(sign('string'), SECRET, NOW)).toBeNull();
  });
});
