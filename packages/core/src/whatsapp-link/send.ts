// The env-selected sender for the link code (#711). Real WhatsApp only when the provider env and the
// approved template name are set (`createWhatsAppOtpSender`); otherwise console outside production.
import { serverEnv } from '@causedeck/config/env';
import { createLogger } from '@causedeck/observability';
import { createWhatsAppOtpSender, type WhatsAppOtpSender } from '@causedeck/notifications/whatsapp';

import { WHATSAPP_OTP_TTL_MS } from './link.ts';

let sender: WhatsAppOtpSender | undefined;

/** `WhatsAppDeps.sendOtp` for the request action, built once from the server env. */
export function whatsappOtpSendFromProcess(): (e164: string, code: string) => Promise<void> {
  sender ??= createWhatsAppOtpSender({
    env: serverEnv(),
    log: createLogger({ service: 'whatsapp-otp' }),
  });
  const active = sender;
  return async (e164, code) => {
    await active.sendOtp({ code, expiresInMinutes: WHATSAPP_OTP_TTL_MS / 60_000 }, { e164 });
  };
}
