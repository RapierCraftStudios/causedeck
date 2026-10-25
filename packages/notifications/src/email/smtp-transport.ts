// SMTP delivery through nodemailer (Mailpit in dev). The URL is revealed only to build the
// transport and is never logged.
import type { Secret } from '@causedeck/config/env';
import { createTransport } from 'nodemailer';

import type { EmailTransport } from './transport.ts';

export function smtpTransport(smtpUrl: Secret, from: string): EmailTransport {
  const transport = createTransport(smtpUrl.reveal());
  return {
    provider: 'smtp',
    async send(message) {
      const info = (await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.headers ? { headers: message.headers } : {}),
      })) as { messageId?: string } | undefined;
      return { messageId: info?.messageId };
    },
  };
}
