// The inbound email provider the process is configured with (#530): `INBOUND_EMAIL_PROVIDER`
// (`ses`, `file` or `mailpit`) plus its settings. Optional deployment toggles outside the typed
// `serverEnv()` schema, like `CAPTURE_*`; with none set there is no provider and the webhook
// rejects every call. SES needs the S3 reader and certificate fetch of #110, which are not wired
// here, so `ses` yields no provider until they are.
import { inboundProviderFromEnv, type InboundEmailProvider } from '@causedeck/capture';

export type { InboundEmailProvider } from '@causedeck/capture';

export function inboundProviderFromProcess(): InboundEmailProvider | null {
  // eslint-disable-next-line no-process-env -- optional INBOUND_EMAIL_* toggles, outside the typed env schema.
  return inboundProviderFromEnv(process.env);
}
