// One-time "Sign in with ChatGPT" login for the preview-only plan adapter (#1165): dynamic client
// registration on first sign-in (`client_id=dynamic_agent_client` with an app name hint and a
// stable `urn:uuid:` host id), PKCE (S256), state and nonce, a loopback redirect, an RS256 id token
// check against OpenAI's JWKS, and an atomic 0600 token file. `scripts/chatgpt-plan-login.ts` is
// the thin CLI around these helpers. Nothing here logs a token.
import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
  type JsonWebKey,
} from 'node:crypto';

import { ProviderError } from '../errors.ts';
import {
  CHATGPT_PLAN_RESOURCE,
  CHATGPT_PLAN_TOKEN_URL,
  readTokenFile,
  writeTokenFileAtomic,
  type ChatgptPlanTokenFile,
} from './chatgpt-plan-token.ts';

export const CHATGPT_PLAN_AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize';
export const CHATGPT_PLAN_OPENID_CONFIGURATION =
  'https://auth.openai.com/.well-known/openid-configuration';
export const CHATGPT_PLAN_REDIRECT_URI = 'http://127.0.0.1:1455/auth/callback';
export const CHATGPT_PLAN_SCOPES =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
/** The client id for first registration; the server issues an `oaiapp_…` id in the callback. */
export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
export const PLAN_USAGE_SCOPE = 'chatgpt.tokens.use.direct';

const base64url = (buf: Buffer): string => buf.toString('base64url');

export interface Pkce {
  verifier: string;
  challenge: string;
}

/** PKCE pair (RFC 7636 S256); `verifier` is injectable for the RFC test vector. */
export function createPkce(verifier: string = base64url(randomBytes(32))): Pkce {
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

/** A random state or nonce value. */
export function randomToken(): string {
  return base64url(randomBytes(24));
}

/** A stable host id for this deployment, sent as `ext_agent_host_id`. */
export function newHostId(): string {
  return `urn:uuid:${randomUUID()}`;
}

export interface AuthorizeUrlInput {
  /** The saved `oaiapp_…` id on re-login; omit on first registration. */
  clientId?: string | undefined;
  /** Shown to the user on first registration (`agent_name_hint`). */
  appName: string;
  extAgentHostId: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}

export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const url = new URL(CHATGPT_PLAN_AUTHORIZE_URL);
  const first = input.clientId === undefined;
  const params: [string, string][] = [
    ['response_type', 'code'],
    ['client_id', input.clientId ?? DYNAMIC_CLIENT_ID],
  ];
  if (first) params.push(['agent_name_hint', input.appName]);
  params.push(
    ['ext_agent_host_id', input.extAgentHostId],
    ['redirect_uri', CHATGPT_PLAN_REDIRECT_URI],
    ['scope', CHATGPT_PLAN_SCOPES],
    ['resource', CHATGPT_PLAN_RESOURCE],
    ['state', input.state],
    ['nonce', input.nonce],
    ['code_challenge', input.codeChallenge],
    ['code_challenge_method', 'S256'],
  );
  for (const [k, v] of params) url.searchParams.set(k, v);
  return url.toString();
}

export class LoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginError';
  }
}

export interface Callback {
  code: string;
  /** The client id to use from now on: the issued one on first registration, else the saved one. */
  clientId: string;
}

/** Validate the loopback callback: state matches, a code is present, an `oaiapp_` id on first sign-in. */
export function parseCallback(
  url: string | URL,
  expected: { state: string; clientId?: string | undefined },
): Callback {
  const params = new URL(url, CHATGPT_PLAN_REDIRECT_URI).searchParams;
  if (params.get('state') !== expected.state) throw new LoginError('state mismatch');
  const error = params.get('error');
  if (error !== null) throw new LoginError(`authorization refused (${error.slice(0, 64)})`);
  const code = params.get('code');
  if (code === null || code === '') throw new LoginError('missing authorization code');
  if (expected.clientId !== undefined) return { code, clientId: expected.clientId };
  const issued = params.get('client_id');
  if (issued === null || !issued.startsWith('oaiapp_')) {
    throw new LoginError('missing issued oaiapp_ client id');
  }
  return { code, clientId: issued };
}

export interface TokenReply {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  scope: string;
  expiresIn: number;
}

/** Exchange the authorization code for tokens. */
export async function exchangeCode(input: {
  clientId: string;
  code: string;
  codeVerifier: string;
  fetch?: typeof fetch;
}): Promise<TokenReply> {
  const doFetch = input.fetch ?? fetch;
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: CHATGPT_PLAN_REDIRECT_URI,
    resource: CHATGPT_PLAN_RESOURCE,
  });
  const response = await doFetch(CHATGPT_PLAN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
  });
  if (!response.ok) {
    throw new ProviderError(
      'chatgpt-plan',
      `code exchange failed (HTTP ${String(response.status)})`,
      {
        status: response.status,
      },
    );
  }
  const r = (await response.json()) as Record<string, unknown>;
  const str = (k: string): string => (typeof r[k] === 'string' ? r[k] : '');
  if (str('access_token') === '' || str('refresh_token') === '' || str('id_token') === '') {
    throw new LoginError('token reply is missing a token');
  }
  return {
    accessToken: str('access_token'),
    refreshToken: str('refresh_token'),
    idToken: str('id_token'),
    scope: str('scope'),
    expiresIn: typeof r.expires_in === 'number' ? r.expires_in : 3_600,
  };
}

export interface IdTokenClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  nonce?: string;
}

interface Jwk {
  kid?: string;
  kty?: string;
  [key: string]: unknown;
}

/**
 * Verify the id token (RS256, OpenAI's JWKS from the OpenID configuration): issuer, audience =
 * client id, expiry and nonce. Also require the granted scope to include plan usage.
 */
export async function verifyIdToken(
  idToken: string,
  expected: {
    clientId: string;
    nonce: string;
    scope: string;
    fetch?: typeof fetch;
    now?: () => Date;
  },
): Promise<IdTokenClaims> {
  const doFetch = expected.fetch ?? fetch;
  const now = expected.now ?? (() => new Date());
  if (!expected.scope.split(/\s+/).includes(PLAN_USAGE_SCOPE)) {
    throw new LoginError(`the granted scope lacks ${PLAN_USAGE_SCOPE}`);
  }
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new LoginError('malformed id token');
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: unknown; kid?: unknown };
  let claims: IdTokenClaims;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as typeof header;
    claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as IdTokenClaims;
  } catch {
    throw new LoginError('malformed id token');
  }
  if (header.alg !== 'RS256') throw new LoginError('unexpected id token algorithm');

  const config = (await (await doFetch(CHATGPT_PLAN_OPENID_CONFIGURATION)).json()) as {
    issuer?: unknown;
    jwks_uri?: unknown;
  };
  if (typeof config.issuer !== 'string' || typeof config.jwks_uri !== 'string') {
    throw new LoginError('invalid OpenID configuration');
  }
  const jwks = (await (await doFetch(config.jwks_uri)).json()) as { keys?: Jwk[] };
  const jwk = (jwks.keys ?? []).find(
    (k) => k.kty === 'RSA' && (header.kid === undefined || k.kid === header.kid),
  );
  if (jwk === undefined) throw new LoginError('no matching signing key');
  const key = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
  const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
  if (!ok) throw new LoginError('id token signature is invalid');

  if (claims.iss !== config.issuer) throw new LoginError('id token issuer mismatch');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expected.clientId)) throw new LoginError('id token audience mismatch');
  if (typeof claims.exp !== 'number' || claims.exp * 1_000 <= now().getTime()) {
    throw new LoginError('id token expired');
  }
  if (claims.nonce !== expected.nonce) throw new LoginError('id token nonce mismatch');
  if (typeof claims.sub !== 'string' || claims.sub === '') {
    throw new LoginError('id token has no subject');
  }
  return claims;
}

/**
 * Write the token file (atomic, 0600). An existing file's `extAgentHostId` is kept, so the host id
 * stays stable across re-logins.
 */
export async function writeTokenFile(
  file: string,
  input: { clientId: string; extAgentHostId: string; tokens: TokenReply; now?: () => Date },
): Promise<ChatgptPlanTokenFile> {
  const now = input.now ?? (() => new Date());
  const existing = await readTokenFile(file).catch(() => null);
  const contents: ChatgptPlanTokenFile = {
    version: 1,
    clientId: input.clientId,
    extAgentHostId: existing?.extAgentHostId ?? input.extAgentHostId,
    accessToken: input.tokens.accessToken,
    refreshToken: input.tokens.refreshToken,
    idToken: input.tokens.idToken,
    scope: input.tokens.scope,
    expiresAt: new Date(now().getTime() + input.tokens.expiresIn * 1_000).toISOString(),
  };
  await writeTokenFileAtomic(file, contents);
  return contents;
}
