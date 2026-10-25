// The Amazon SES inbound provider (#530). SES receipt rules write the raw message to S3 and
// publish an SNS notification; this verifies the SNS message signature (SignatureVersion 1 and 2,
// the signing certificate fetched only from an `sns.<region>.amazonaws.com` host), reads the
// notification and fetches the raw message from S3. The S3 reader, the certificate fetch and the
// subscription confirmation are injected: real credentials are #110, tests pass fakes.
import { createVerify } from 'node:crypto';

import type {
  InboundEmailProvider,
  InboundNotification,
  InboundRequest,
  InboundVerification,
} from '../provider.ts';

export interface SesProviderOptions {
  /** Returns the PEM certificate (or public key) at the signing URL. */
  fetchCertificate: (url: string) => Promise<string>;
  readObject: (bucket: string, key: string) => Promise<Uint8Array>;
  deleteObject?: (bucket: string, key: string) => Promise<void>;
  /** Called with the `SubscribeURL` of a verified `SubscriptionConfirmation`. */
  confirmSubscription?: (url: string) => Promise<void>;
  /** When set, only these topics are accepted. */
  allowedTopicArns?: readonly string[];
}

type SnsMessage = Record<string, string | undefined>;

const SNS_HOST = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?\//;

const SIGNED_FIELDS: Record<string, readonly string[]> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: [
    'Message',
    'MessageId',
    'SubscribeURL',
    'Timestamp',
    'Token',
    'TopicArn',
    'Type',
  ],
  UnsubscribeConfirmation: [
    'Message',
    'MessageId',
    'SubscribeURL',
    'Timestamp',
    'Token',
    'TopicArn',
    'Type',
  ],
};

/** The string SNS signed: `Name\nValue\n` for each present field, in the documented order. */
export function snsStringToSign(message: SnsMessage): string | null {
  const fields = SIGNED_FIELDS[message['Type'] ?? ''];
  if (fields === undefined) return null;
  let out = '';
  for (const name of fields) {
    const value = message[name];
    if (value === undefined) {
      if (name === 'Subject') continue;
      return null;
    }
    out += `${name}\n${value}\n`;
  }
  return out;
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** The notification inside an SES `Received` message, or null when it is anything else. */
export function sesNotification(message: string): InboundNotification | null {
  const body = parseJson(message);
  if (body === null || body['notificationType'] !== 'Received') return null;
  const mail = body['mail'] as
    | { messageId?: string; destination?: unknown; commonHeaders?: { messageId?: string } }
    | undefined;
  const receipt = body['receipt'] as
    | { recipients?: unknown; action?: { type?: string; bucketName?: string; objectKey?: string } }
    | undefined;
  const action = receipt?.action;
  if (action?.type !== 'S3' || !action.bucketName || !action.objectKey) return null;
  const messageId = mail?.commonHeaders?.messageId ?? mail?.messageId;
  const recipients = strings(receipt?.recipients ?? mail?.destination).map((r) =>
    r.trim().toLowerCase(),
  );
  if (messageId === undefined || messageId === '' || recipients.length === 0) return null;
  return {
    messageId: messageId.replace(/^<|>$/g, ''),
    recipients,
    rawRef: `s3://${action.bucketName}/${action.objectKey}`,
  };
}

function splitRef(rawRef: string): { bucket: string; key: string } {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(rawRef);
  if (match?.[1] === undefined || match[2] === undefined) throw new Error('invalid S3 reference');
  return { bucket: match[1], key: match[2] };
}

export function createSesProvider(options: SesProviderOptions): InboundEmailProvider {
  async function verify(request: InboundRequest): Promise<InboundVerification> {
    const parsed = parseJson(request.body);
    if (parsed === null) return { ok: false, reason: 'bad_body' };
    const message: SnsMessage = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') message[key] = value;
    }
    const toSign = snsStringToSign(message);
    const signature = message['Signature'];
    const certUrl = message['SigningCertURL'];
    const version = message['SignatureVersion'];
    if (toSign === null || signature === undefined || certUrl === undefined) {
      return { ok: false, reason: 'bad_message' };
    }
    if (version !== '1' && version !== '2') return { ok: false, reason: 'bad_signature_version' };
    if (!SNS_HOST.test(certUrl) || !certUrl.endsWith('.pem')) {
      return { ok: false, reason: 'bad_cert_url' };
    }
    const topic = message['TopicArn'] ?? '';
    if (options.allowedTopicArns && !options.allowedTopicArns.includes(topic)) {
      return { ok: false, reason: 'topic_not_allowed' };
    }
    let valid = false;
    try {
      const certificate = await options.fetchCertificate(certUrl);
      valid = createVerify(version === '2' ? 'RSA-SHA256' : 'RSA-SHA1')
        .update(toSign, 'utf8')
        .verify(certificate, signature, 'base64');
    } catch {
      valid = false;
    }
    if (!valid) return { ok: false, reason: 'bad_signature' };

    if (message['Type'] === 'SubscriptionConfirmation') {
      const url = message['SubscribeURL'] ?? '';
      if (SNS_HOST.test(url)) await options.confirmSubscription?.(url);
      return { ok: true, notifications: [] };
    }
    if (message['Type'] !== 'Notification') return { ok: true, notifications: [] };
    const notification = sesNotification(message['Message'] ?? '');
    return { ok: true, notifications: notification === null ? [] : [notification] };
  }

  return {
    id: 'ses',
    verify,
    fetchRaw: async (rawRef) => {
      const { bucket, key } = splitRef(rawRef);
      return options.readObject(bucket, key);
    },
    ...(options.deleteObject === undefined
      ? {}
      : {
          discardRaw: async (rawRef: string) => {
            const { bucket, key } = splitRef(rawRef);
            await options.deleteObject?.(bucket, key);
          },
        }),
  };
}
