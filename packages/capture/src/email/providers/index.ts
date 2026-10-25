// Inbound email providers (#530) and the one that deployment settings select.
import { createFileProvider } from './file.ts';
import { createMailpitProvider } from './mailpit.ts';
import { createSesProvider, type SesProviderOptions } from './ses.ts';
import type { InboundEmailProvider } from '../provider.ts';

export * from './file.ts';
export * from './mailpit.ts';
export * from './ses.ts';

export interface InboundProviderEnv {
  INBOUND_EMAIL_PROVIDER?: string | undefined;
  INBOUND_EMAIL_SECRET?: string | undefined;
  INBOUND_EMAIL_DIR?: string | undefined;
  MAILPIT_URL?: string | undefined;
  SES_INBOUND_TOPIC_ARNS?: string | undefined;
}

/**
 * The provider selected by `INBOUND_EMAIL_PROVIDER` (`ses`, `file` or `mailpit`); `null` when none
 * is configured, so the webhook rejects everything. `ses` needs its S3 reader and certificate
 * fetch from the caller (real credentials are #110).
 */
export function inboundProviderFromEnv(
  env: InboundProviderEnv,
  ses?: Omit<SesProviderOptions, 'allowedTopicArns'>,
): InboundEmailProvider | null {
  const secret = env.INBOUND_EMAIL_SECRET ?? '';
  switch (env.INBOUND_EMAIL_PROVIDER) {
    case 'file':
      return env.INBOUND_EMAIL_DIR === undefined || secret === ''
        ? null
        : createFileProvider({ dir: env.INBOUND_EMAIL_DIR, secret });
    case 'mailpit':
      return env.MAILPIT_URL === undefined || secret === ''
        ? null
        : createMailpitProvider({ baseUrl: env.MAILPIT_URL, secret });
    case 'ses': {
      if (ses === undefined) return null;
      const topics = (env.SES_INBOUND_TOPIC_ARNS ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== '');
      return createSesProvider({
        ...ses,
        ...(topics.length > 0 ? { allowedTopicArns: topics } : {}),
      });
    }
    default:
      return null;
  }
}
