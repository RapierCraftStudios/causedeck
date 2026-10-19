// VAPID configuration for Web Push (#197, #23; spike §1). The key pair comes from the env
// (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` as a `Secret`); without it push is disabled and nothing
// throws, so boot never depends on push credentials. Keys are generated once with
// `pnpm --filter @causedeck/notifications vapid:generate`.
import type { Secret } from '@causedeck/config/env';
import webpush from 'web-push';

export interface PushEnv {
  APP_URL: string;
  VAPID_PUBLIC_KEY?: string | undefined;
  VAPID_PRIVATE_KEY?: Secret | undefined;
  VAPID_SUBJECT?: string | undefined;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: Secret;
  /** `mailto:` or `https:` contact the push services can reach. */
  subject: string;
}

/** The VAPID config, or `null` when the key pair is absent (push disabled). */
export function pushConfig(env: PushEnv): VapidConfig | null {
  if (env.VAPID_PUBLIC_KEY === undefined || env.VAPID_PRIVATE_KEY === undefined) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT ?? `mailto:push@${new URL(env.APP_URL).hostname}`,
  };
}

/** The `vapidDetails` option `web-push` signs with; the private key is revealed only here. */
export function vapidDetails(config: VapidConfig): {
  subject: string;
  publicKey: string;
  privateKey: string;
} {
  return {
    subject: config.subject,
    publicKey: config.publicKey,
    privateKey: config.privateKey.reveal(),
  };
}

/** A fresh URL-safe base64 VAPID key pair. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
