// The Mailpit inbound provider (#530): dev mail caught by Mailpit, announced by a shared-secret
// post whose `ref` is the Mailpit message id; the raw message is read over its HTTP API.
import { verifyDevRequest, type InboundEmailProvider } from '../provider.ts';

export interface MailpitProviderOptions {
  /** Mailpit's base URL, for example `http://localhost:8025`. */
  baseUrl: string;
  secret: string;
  fetch?: typeof fetch;
}

const MESSAGE_REF = /^[A-Za-z0-9_-]{1,64}$/;

export function createMailpitProvider(options: MailpitProviderOptions): InboundEmailProvider {
  const http = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, '');
  const url = (ref: string): string => {
    if (!MESSAGE_REF.test(ref)) throw new Error('invalid Mailpit message id');
    return `${base}/api/v1/message/${ref}/raw`;
  };
  return {
    id: 'mailpit',
    verify: (request) => {
      const result = verifyDevRequest(request, options.secret);
      if (result.ok && !result.notifications.every((n) => MESSAGE_REF.test(n.rawRef))) {
        return Promise.resolve({ ok: false, reason: 'bad_ref' });
      }
      return Promise.resolve(result);
    },
    fetchRaw: async (rawRef) => {
      const response = await http(url(rawRef));
      if (!response.ok) throw new Error(`Mailpit returned ${String(response.status)}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
