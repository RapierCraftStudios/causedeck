import { describe, expect, it } from 'vitest';

import {
  isBlockedSsoPath,
  isSsoPath,
  parseSsoConfig,
  SsoConfigError,
  ssoDomainOf,
} from '../sso';

const context = {
  protocol: 'oidc',
  issuer: 'https://idp.example.com/',
  providerId: '3f2c6c0e-0000-4000-8000-000000000001',
  baseUrl: 'https://app.example.com/',
} as const;

describe('ssoDomainOf', () => {
  it('takes the lower-case domain of an email or a bare domain', () => {
    expect(ssoDomainOf(' Ada@Firm.Example.COM ')).toBe('firm.example.com');
    expect(ssoDomainOf('firm.example.com')).toBe('firm.example.com');
  });

  it('rejects anything that is not a domain', () => {
    for (const value of ['', 'a@', 'localhost', 'a@b', '-x.example.com', 'a b.example.com', 'a@x.c']) {
      expect(ssoDomainOf(value), value).toBeNull();
    }
  });
});

describe('SSO paths', () => {
  it('exposes only the sign-in start, callbacks and SAML metadata', () => {
    expect(isSsoPath('/sign-in/sso')).toBe(true);
    expect(isBlockedSsoPath('/sign-in/sso')).toBe(false);
    expect(isBlockedSsoPath('/sso/callback/abc')).toBe(false);
    expect(isBlockedSsoPath('/sso/saml2/sp/acs/abc')).toBe(false);
    for (const path of [
      '/sso/register',
      '/sso/providers',
      '/sso/get-provider',
      '/sso/update-provider',
      '/sso/delete-provider',
      '/sso/request-domain-verification',
      '/sso/verify-domain',
    ]) {
      expect(isBlockedSsoPath(path), path).toBe(true);
    }
    expect(isBlockedSsoPath('/sign-in/magic-link')).toBe(false);
  });
});

describe('parseSsoConfig', () => {
  it('expands OIDC settings with PKCE and the issuer discovery document', () => {
    expect(parseSsoConfig(context, { clientId: ' id ', clientSecret: 's3cret' })).toMatchObject({
      issuer: 'https://idp.example.com',
      pkce: true,
      clientId: 'id',
      clientSecret: 's3cret',
      discoveryEndpoint: 'https://idp.example.com/.well-known/openid-configuration',
      scopes: ['openid', 'email', 'profile'],
    });
  });

  it('expands SAML settings with the assertion consumer URL of the provider', () => {
    const config = parseSsoConfig(
      { ...context, protocol: 'saml' },
      { entryPoint: 'https://idp.example.com/sso', cert: 'MIIB' },
    );
    expect(config).toMatchObject({
      entryPoint: 'https://idp.example.com/sso',
      callbackUrl: `https://app.example.com/api/auth/sso/saml2/sp/acs/${context.providerId}`,
      wantAssertionsSigned: true,
    });
  });

  it('refuses missing settings and non-https URLs with SsoConfigError', () => {
    expect(() => parseSsoConfig(context, {})).toThrow(SsoConfigError);
    expect(() =>
      parseSsoConfig(context, {
        clientId: 'id',
        clientSecret: 's',
        discoveryEndpoint: 'http://idp.example.com/.well-known/openid-configuration',
      }),
    ).toThrow(SsoConfigError);
    expect(() =>
      parseSsoConfig({ ...context, protocol: 'saml' }, { entryPoint: 'http://idp', cert: 'x' }),
    ).toThrow(SsoConfigError);
  });
});
