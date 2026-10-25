// Logs the email instead of sending it (dev/CI default). The plain-text body is part of the log
// message so links inside it stand on their own lines and terminals make them clickable.
import type { EmailLogger, EmailTransport } from './transport.ts';

export function consoleTransport(logger: EmailLogger): EmailTransport {
  return {
    provider: 'console',
    send(message) {
      logger.info(
        {
          to: message.to,
          subject: message.subject,
          ...(message.headers ? { headers: message.headers } : {}),
          ...message.tags,
          htmlLength: message.html.length,
        },
        `email (console transport)\n${message.text}\n`,
      );
      return Promise.resolve({});
    },
  };
}
