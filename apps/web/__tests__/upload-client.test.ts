// Browser upload helper (#436): intent → PUT to the presigned URL with the signed headers → finalize,
// in that order and with those bodies; the route's statuses map to typed failures, and a failed PUT
// or a network error is `failed`. Nothing is finalized when the PUT fails.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UPLOADS_PATH, uploadFile } from '../lib/upload-client.ts';

const WORKSPACE = '00000000-0000-4000-8000-000000000001';
const BLOB = '00000000-0000-4000-8000-0000000000b1';
const SIGNED = {
  url: 'https://store.example.test/put?sig=1',
  method: 'PUT',
  headers: { 'content-type': 'application/pdf', 'content-length': '5' },
};

const pdf = () => new File(['%PDF-'], 'roster.pdf', { type: 'application/pdf' });
const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(...responses: (Response | Error)[]) {
  const fetchMock = vi.fn(() => {
    const next = responses.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? new Response(null, { status: 500 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function bodyOf(call: unknown[]): unknown {
  const init = call[1] as RequestInit;
  return JSON.parse(init.body as string);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadFile', () => {
  it('asks for an intent, PUTs the file with the signed headers, then finalizes', async () => {
    const fetchMock = stubFetch(
      json(201, { blobId: BLOB, upload: SIGNED }),
      new Response(null, { status: 200 }),
      json(200, { blobId: BLOB }),
    );
    const file = pdf();
    await expect(uploadFile(WORKSPACE, file)).resolves.toEqual({ ok: true, blobId: BLOB });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [intent, put, finalize] = fetchMock.mock.calls as unknown as unknown[][];
    expect(intent?.[0]).toBe(UPLOADS_PATH);
    expect((intent?.[1] as RequestInit).method).toBe('POST');
    expect(bodyOf(intent as unknown[])).toEqual({
      action: 'intent',
      workspaceId: WORKSPACE,
      kind: 'document',
      filename: 'roster.pdf',
      size: 5,
      mime: 'application/pdf',
    });
    expect(put?.[0]).toBe(SIGNED.url);
    expect(put?.[1]).toEqual({ method: 'PUT', headers: SIGNED.headers, body: file });
    expect(finalize?.[0]).toBe(UPLOADS_PATH);
    expect(bodyOf(finalize as unknown[])).toEqual({
      action: 'finalize',
      workspaceId: WORKSPACE,
      blobId: BLOB,
    });
  });

  it.each([
    [400, 'invalid'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [413, 'too_large'],
    [429, 'rate_limited'],
    [500, 'failed'],
  ] as const)('maps an intent %i to %s', async (status, error) => {
    const fetchMock = stubFetch(json(status, { error: 'x' }));
    await expect(uploadFile(WORKSPACE, pdf())).resolves.toEqual({ ok: false, error });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not finalize when the PUT fails', async () => {
    const fetchMock = stubFetch(
      json(201, { blobId: BLOB, upload: SIGNED }),
      new Response(null, { status: 403 }),
    );
    await expect(uploadFile(WORKSPACE, pdf())).resolves.toEqual({ ok: false, error: 'failed' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps a finalize failure by status', async () => {
    stubFetch(
      json(201, { blobId: BLOB, upload: SIGNED }),
      new Response(null, { status: 200 }),
      json(400, { error: 'validation' }),
    );
    await expect(uploadFile(WORKSPACE, pdf())).resolves.toEqual({ ok: false, error: 'invalid' });
  });

  it('is `failed` on a network error', async () => {
    stubFetch(new TypeError('network down'));
    await expect(uploadFile(WORKSPACE, pdf())).resolves.toEqual({ ok: false, error: 'failed' });
  });
});
