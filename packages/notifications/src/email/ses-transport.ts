// Amazon SES v2 delivery (spike §1: SES in ap-south-1). Email stays in India: a region outside
// India is rejected when the transport is built, mirroring the env guardrail on SES_REGION (both
// yield only to the explicit AWS_REGION_OVERRIDE_ACK acknowledgement).
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { INDIA_AWS_REGIONS, type Secret } from '@causedeck/config/env';

import type { EmailTransport } from './transport.ts';

/** AWS regions in India (Mumbai, Hyderabad), shared with the env guardrails. */
export const SES_INDIA_REGIONS = INDIA_AWS_REGIONS;

export const SES_DEFAULT_REGION = 'ap-south-1';

export interface SesTransportOptions {
  region?: string;
  accessKeyId: string;
  secretAccessKey: Secret;
  from: string;
  /** Set only from `AWS_REGION_OVERRIDE_ACK`; email otherwise never leaves India. */
  allowNonIndiaRegion?: boolean;
}

export function sesTransport({
  region = SES_DEFAULT_REGION,
  accessKeyId,
  secretAccessKey,
  from,
  allowNonIndiaRegion = false,
}: SesTransportOptions): EmailTransport {
  if (!allowNonIndiaRegion && !(SES_INDIA_REGIONS as readonly string[]).includes(region)) {
    throw new Error(
      `SES region must be an India region (${SES_INDIA_REGIONS.join(', ')}); got "${region}"`,
    );
  }
  const client = new SESv2Client({
    region,
    credentials: { accessKeyId, secretAccessKey: secretAccessKey.reveal() },
  });
  return {
    provider: 'ses',
    async send(message) {
      const headers = Object.entries(message.headers ?? {}).map(([Name, Value]) => ({
        Name,
        Value,
      }));
      const result = await client.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [message.to] },
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: message.html, Charset: 'UTF-8' },
                Text: { Data: message.text, Charset: 'UTF-8' },
              },
              ...(headers.length > 0 ? { Headers: headers } : {}),
            },
          },
        }),
      );
      return { messageId: result.MessageId };
    },
  };
}
