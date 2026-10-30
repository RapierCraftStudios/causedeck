// In-process S3-compatible target (path-style) for the provider-swap conformance run (#106). It
// speaks the object operations `s3-provider` uses and verifies SigV4 presigned URLs (signature,
// signed headers, expiry) so the shared contract exercises the same failures MinIO produces.
import { createHash, createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const MOCK_ACCESS_KEY = 'mock-access-key';
export const MOCK_SECRET_KEY = 'mock-secret-key-not-a-secret';

interface Stored {
  body: Buffer;
  contentType: string;
  modified: Date;
}

export interface StartedS3Mock {
  endpoint: string;
  createBucket: (name: string) => void;
  stop: () => Promise<void>;
}

const sha256 = (data: string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) =>
  createHmac('sha256', key).update(data).digest();

function xml(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'application/xml' });
  res.end(`<?xml version="1.0" encoding="UTF-8"?>${body}`);
}

function denied(res: ServerResponse): void {
  xml(res, 403, '<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>');
}

/** Whether the presigned query of `req` is valid right now; `serverNow` is the mock's own clock. */
function presignedValid(req: IncomingMessage, url: URL, serverNow: () => number): boolean {
  const raw = (req.url ?? '').split('?')[1] ?? '';
  const pairs = raw.split('&').map((p) => p.split('=') as [string, string]);
  const q = new Map(pairs);
  const signature = q.get('X-Amz-Signature');
  const date = q.get('X-Amz-Date');
  const expires = Number(q.get('X-Amz-Expires'));
  const credential = decodeURIComponent(q.get('X-Amz-Credential') ?? '').split('/');
  const signedHeaders = decodeURIComponent(q.get('X-Amz-SignedHeaders') ?? '');
  if (!signature || !date || !Number.isFinite(expires) || credential.length !== 5) return false;
  if (credential[0] !== MOCK_ACCESS_KEY) return false;

  const issued = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    Number(date.slice(9, 11)),
    Number(date.slice(11, 13)),
    Number(date.slice(13, 15)),
  );
  if (serverNow() > issued + expires * 1000) return false;

  const query = pairs
    .filter(([k]) => k !== 'X-Amz-Signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const headers = signedHeaders
    .split(';')
    .map((name) => `${name}:${String(req.headers[name] ?? '').trim()}\n`)
    .join('');
  const canonical = [
    req.method,
    url.pathname,
    query,
    headers,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const [, day, region, service] = credential as [string, string, string, string, string];
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', date, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${MOCK_SECRET_KEY}`, day), region), service),
    'aws4_request',
  );
  return createHmac('sha256', signingKey).update(toSign).digest('hex') === signature;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function startS3Mock(): Promise<StartedS3Mock> {
  const buckets = new Map<string, Map<string, Stored>>();
  // The mock keeps its own monotonic clock so a test that fakes `Date` only skews the client.
  const startedAt = Date.now();
  const startedTick = process.hrtime.bigint();
  const serverNow = () => startedAt + Number((process.hrtime.bigint() - startedTick) / 1_000_000n);

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    const presigned = url.searchParams.has('X-Amz-Signature');
    if (presigned ? !presignedValid(req, url, serverNow) : !req.headers.authorization) {
      denied(res);
      await readBody(req);
      return;
    }
    const [bucketName, ...rest] = url.pathname.split('/').filter(Boolean);
    const bucket = bucketName === undefined ? undefined : buckets.get(bucketName);
    if (!bucket) {
      xml(res, 404, '<Error><Code>NoSuchBucket</Code></Error>');
      await readBody(req);
      return;
    }
    const key = decodeURIComponent(rest.join('/'));

    if (key === '') {
      if (req.method === 'HEAD') {
        res.writeHead(200).end();
      } else if (req.method === 'GET') {
        const prefix = url.searchParams.get('prefix') ?? '';
        const keys = [...bucket.keys()].filter((k) => k.startsWith(prefix)).sort();
        const items = keys.map((k) => {
          const o = bucket.get(k) as Stored;
          return `<Contents><Key>${k}</Key><LastModified>${o.modified.toISOString()}</LastModified><ETag>"x"</ETag><Size>${String(o.body.length)}</Size></Contents>`;
        });
        xml(
          res,
          200,
          `<ListBucketResult><Name>${bucketName ?? ''}</Name><Prefix>${prefix}</Prefix><KeyCount>${String(keys.length)}</KeyCount><IsTruncated>false</IsTruncated>${items.join('')}</ListBucketResult>`,
        );
      } else res.writeHead(405).end();
      return;
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      bucket.set(key, {
        body,
        contentType: req.headers['content-type'] ?? 'application/octet-stream',
        modified: new Date(),
      });
      res.writeHead(200, { etag: '"x"' }).end();
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      const o = bucket.get(key);
      if (!o) {
        if (req.method === 'HEAD') res.writeHead(404).end();
        else xml(res, 404, '<Error><Code>NoSuchKey</Code></Error>');
        return;
      }
      res.writeHead(200, {
        'content-type': url.searchParams.get('response-content-type') ?? o.contentType,
        'content-length': String(o.body.length),
        'last-modified': o.modified.toUTCString(),
        etag: '"x"',
        ...(url.searchParams.has('response-content-disposition')
          ? {
              'content-disposition': url.searchParams.get('response-content-disposition') as string,
            }
          : {}),
      });
      res.end(req.method === 'HEAD' ? undefined : o.body);
    } else if (req.method === 'DELETE') {
      bucket.delete(key);
      res.writeHead(204).end();
    } else res.writeHead(405).end();
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${String(port)}`,
    createBucket: (name) => {
      buckets.set(name, new Map());
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
