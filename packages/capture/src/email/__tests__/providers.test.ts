// The inbound providers (#530): SNS signature verification, the shared-secret dev providers and
// the file provider's path containment. No network: certificate and object reads are injected.
import { createSign, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { INBOUND_SECRET_HEADER, parseDevNotification, verifySharedSecret } from '../provider.ts';
import { createFileProvider } from '../providers/file.ts';
import { createMailpitProvider } from '../providers/mailpit.ts';
import { createSesProvider, snsStringToSign } from '../providers/ses.ts';
import { inboundProviderFromEnv } from '../providers/index.ts';

const CERT_URL = 'https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-test.pem';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const received = JSON.stringify({
  notificationType: 'Received',
  mail: { messageId: 'ses-1', commonHeaders: { messageId: '<abc@mail.test>' } },
  receipt: {
    recipients: ['U-abcdefghij@Intake.Test'],
    action: { type: 'S3', bucketName: 'inbound', objectKey: 'mail/ses-1' },
  },
});

function signed(fields: Record<string, string>, version = '2'): string {
  const message: Record<string, string> = {
    Type: 'Notification',
    MessageId: 'sns-1',
    TopicArn: 'arn:aws:sns:ap-south-1:1:inbound',
    Timestamp: '2026-10-22T10:00:00.000Z',
    Message: received,
    SignatureVersion: version,
    SigningCertURL: CERT_URL,
    ...fields,
  };
  const toSign = snsStringToSign(message) ?? '';
  const signature = createSign(version === '2' ? 'RSA-SHA256' : 'RSA-SHA1')
    .update(toSign)
    .sign(privateKey, 'base64');
  return JSON.stringify({ ...message, Signature: signature });
}

const ses = (extra: Partial<Parameters<typeof createSesProvider>[0]> = {}) =>
  createSesProvider({
    fetchCertificate: () => Promise.resolve(PEM),
    readObject: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    ...extra,
  });

describe('ses provider', () => {
  it('accepts a signed SES notification and reads the recipients and raw reference', async () => {
    for (const version of ['1', '2']) {
      const result = await ses().verify({ headers: {}, body: signed({}, version) });
      expect(result).toEqual({
        ok: true,
        notifications: [
          {
            messageId: 'abc@mail.test',
            recipients: ['u-abcdefghij@intake.test'],
            rawRef: 's3://inbound/mail/ses-1',
          },
        ],
      });
    }
  });

  it('rejects a tampered message, a foreign certificate host and an unlisted topic', async () => {
    const tampered = JSON.stringify({ ...JSON.parse(signed({})), Message: '{}' });
    expect(await ses().verify({ headers: {}, body: tampered })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    const fetchCertificate = vi.fn(() => Promise.resolve(PEM));
    const foreign = signed({ SigningCertURL: 'https://evil.example.test/cert.pem' });
    expect(await ses({ fetchCertificate }).verify({ headers: {}, body: foreign })).toEqual({
      ok: false,
      reason: 'bad_cert_url',
    });
    expect(fetchCertificate).not.toHaveBeenCalled();
    const other = await ses({ allowedTopicArns: ['arn:aws:sns:ap-south-1:1:other'] }).verify({
      headers: {},
      body: signed({}),
    });
    expect(other).toEqual({ ok: false, reason: 'topic_not_allowed' });
  });

  it('rejects garbage without throwing', async () => {
    expect(await ses().verify({ headers: {}, body: 'nope' })).toEqual({
      ok: false,
      reason: 'bad_body',
    });
  });

  it('confirms a signed subscription only at an SNS host', async () => {
    const confirmSubscription = vi.fn(() => Promise.resolve());
    const body = signed({
      Type: 'SubscriptionConfirmation',
      Token: 't',
      SubscribeURL: 'https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription',
    });
    const result = await ses({ confirmSubscription }).verify({ headers: {}, body });
    expect(result).toEqual({ ok: true, notifications: [] });
    expect(confirmSubscription).toHaveBeenCalledTimes(1);
  });

  it('fetches and discards the raw message by its s3 reference', async () => {
    const deleteObject = vi.fn(() => Promise.resolve());
    const provider = ses({ deleteObject });
    expect(await provider.fetchRaw('s3://inbound/mail/ses-1')).toEqual(new Uint8Array([1, 2, 3]));
    await provider.discardRaw?.('s3://inbound/mail/ses-1');
    expect(deleteObject).toHaveBeenCalledWith('inbound', 'mail/ses-1');
    await expect(provider.fetchRaw('mail/ses-1')).rejects.toThrow('invalid S3 reference');
  });
});

describe('dev providers', () => {
  const body = JSON.stringify({
    messageId: '<m1@test>',
    recipients: ['U-abcdefghij@intake.test'],
    ref: 'aims-plain.eml',
  });
  const headers = { [INBOUND_SECRET_HEADER]: 's3cret' };

  it('checks the shared secret in constant time terms and parses the body', () => {
    expect(verifySharedSecret('s3cret', 's3cret')).toBe(true);
    expect(verifySharedSecret('s3creT', 's3cret')).toBe(false);
    expect(verifySharedSecret(undefined, 's3cret')).toBe(false);
    expect(parseDevNotification(body)).toMatchObject({ recipients: ['u-abcdefghij@intake.test'] });
    expect(parseDevNotification('{"messageId":"x"}')).toBeNull();
  });

  it('the file provider rejects a wrong secret and refs that leave the directory', async () => {
    const provider = createFileProvider({
      dir: '/tmp/inbound',
      secret: 's3cret',
      readFile: (file) => Promise.resolve(new TextEncoder().encode(file)),
    });
    expect((await provider.verify({ headers: {}, body })).ok).toBe(false);
    expect((await provider.verify({ headers, body })).ok).toBe(true);
    const escape = body.replace('aims-plain.eml', '../etc/passwd');
    expect(await provider.verify({ headers, body: escape })).toEqual({
      ok: false,
      reason: 'bad_ref',
    });
    await expect(provider.fetchRaw('../x.eml')).rejects.toThrow('invalid file reference');
    expect(new TextDecoder().decode(await provider.fetchRaw('aims-plain.eml'))).toBe(
      '/tmp/inbound/aims-plain.eml',
    );
  });

  it('the mailpit provider reads the raw message over HTTP', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('From: a@b.test\n\nhi')));
    const provider = createMailpitProvider({
      baseUrl: 'http://mailpit:8025/',
      secret: 's3cret',
      fetch: fetchMock,
    });
    const ok = body.replace('aims-plain.eml', 'AbC123');
    expect((await provider.verify({ headers, body: ok })).ok).toBe(true);
    expect(new TextDecoder().decode(await provider.fetchRaw('AbC123'))).toContain('hi');
    expect(fetchMock).toHaveBeenCalledWith('http://mailpit:8025/api/v1/message/AbC123/raw');
  });
});

describe('inboundProviderFromEnv', () => {
  it('returns null unless a provider is fully configured', () => {
    expect(inboundProviderFromEnv({})).toBeNull();
    expect(inboundProviderFromEnv({ INBOUND_EMAIL_PROVIDER: 'file' })).toBeNull();
    expect(inboundProviderFromEnv({ INBOUND_EMAIL_PROVIDER: 'ses' })).toBeNull();
    expect(
      inboundProviderFromEnv({
        INBOUND_EMAIL_PROVIDER: 'file',
        INBOUND_EMAIL_SECRET: 'x',
        INBOUND_EMAIL_DIR: '/tmp',
      })?.id,
    ).toBe('file');
  });
});
