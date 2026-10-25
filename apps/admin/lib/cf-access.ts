// Cloudflare Access (#309): when `CF_ACCESS_AUD` is set, every request must carry a
// `Cf-Access-Jwt-Assertion` signed by the team's keys (https://<team>/cdn-cgi/access/certs), issued
// by the team domain, for this application's audience, and unexpired.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export const CF_ACCESS_HEADER = 'cf-access-jwt-assertion';

export type CfAccessVerifier = (token: string | null | undefined) => Promise<boolean>;

export interface CfAccessConfig {
  teamDomain: string;
  aud: string;
  /** Key source; defaults to the team's remote JWKS. Tests pass a local key set. */
  keys?: JWTVerifyGetKey;
}

export function createCfAccessVerifier({
  teamDomain,
  aud,
  keys,
}: CfAccessConfig): CfAccessVerifier {
  const issuer = `https://${teamDomain}`;
  const keySet = keys ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  return async (token) => {
    if (!token) return false;
    try {
      await jwtVerify(token, keySet, { audience: aud, issuer, algorithms: ['RS256'] });
      return true;
    } catch {
      return false;
    }
  };
}
