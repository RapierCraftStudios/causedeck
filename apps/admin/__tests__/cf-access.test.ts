import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { createCfAccessVerifier, type CfAccessVerifier } from '../lib/cf-access.ts';

const TEAM = 'causedeck-test.cloudflareaccess.com';
const AUD = 'aud-tag-309';

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let verify: CfAccessVerifier;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  verify = createCfAccessVerifier({
    teamDomain: TEAM,
    aud: AUD,
    keys: createLocalJWKSet({ keys: [jwk] }),
  });
});

function token(
  claims: { aud?: string; iss?: string; exp?: string } = {},
  key: CryptoKey = privateKey,
): Promise<string> {
  return new SignJWT({ email: 'ops@causedeck.test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(claims.iss ?? `https://${TEAM}`)
    .setAudience(claims.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(claims.exp ?? '5m')
    .sign(key);
}

describe('Cloudflare Access verifier', () => {
  it('accepts a valid assertion', async () => {
    expect(await verify(await token())).toBe(true);
  });

  it('rejects a missing, wrong-audience, wrong-issuer, expired or foreign-signed assertion', async () => {
    expect(await verify(undefined)).toBe(false);
    expect(await verify('')).toBe(false);
    expect(await verify(await token({ aud: 'another-app' }))).toBe(false);
    expect(await verify(await token({ iss: 'https://evil.cloudflareaccess.com' }))).toBe(false);
    expect(await verify(await token({ exp: '1s ago' }))).toBe(false);
    expect(await verify(await token({}, otherKey))).toBe(false);
  });
});
