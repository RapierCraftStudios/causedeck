// AWS Signature Version 4 for a JSON POST, so the Bedrock adapter needs no SDK (decision K2:
// one endpoint, one request shape, and a request body we can assert contains no tool config).
import { createHash, createHmac } from 'node:crypto';

const sha256 = (data: string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest();

export interface SignInput {
  region: string;
  service: string;
  host: string;
  /** Already URI-encoded path, e.g. `/model/<id>/converse`. */
  path: string;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
}

export function signRequest(input: SignInput): Record<string, string> {
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(input.body);
  // SigV4 canonicalises the path by encoding each segment once more.
  const canonicalPath = input.path
    .split('/')
    .map((s) => encodeURIComponent(decodeURIComponent(s)))
    .join('/');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host: input.host,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n] ?? ''}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = ['POST', canonicalPath, '', canonicalHeaders, signedHeaders, payloadHash].join(
    '\n',
  );
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  return {
    'content-type': 'application/json',
    'x-amz-date': amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
