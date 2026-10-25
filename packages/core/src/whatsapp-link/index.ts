// The WhatsApp number link (#678, part 1 of #502, D-029): a member requests a one-time code to a
// number, opts in, verifies it, picks the categories and can unlink. Messages may only ever target
// the verified number of the owning user (`getWhatsAppSendTarget`). Sending is a later part (#679). Inbound forward-in (#680): `receive.ts` (webhook side) and `run.ts` (the `whatsapp.intake` job body); the capture domain is read through its index.
export {
  getWhatsAppLink,
  getWhatsAppSendTarget,
  requestWhatsAppOtp,
  setWhatsAppCategories,
  unlinkWhatsApp,
  verifyWhatsAppOtp,
  WHATSAPP_OTP_MAX_ATTEMPTS,
  WHATSAPP_OTP_RESEND_COOLDOWN_MS,
  WHATSAPP_OTP_TTL_MS,
  type RequestWhatsAppOtpInput,
  type WhatsAppActor,
  type WhatsAppDeps,
  type WhatsAppLinkView,
  type WhatsAppSendTarget,
} from './link.ts';
export {
  receiveInboundWhatsApp,
  whatsappInboundProviderFromProcess,
  type InboundWhatsAppInput,
  type InboundWhatsAppOutcome,
  type InboundWhatsAppTarget,
} from './receive.ts';
export {
  runWhatsAppIntake,
  type WhatsAppIntakeDeps,
  type WhatsAppIntakeOutcome,
  type WhatsAppIntakePayload,
} from './run.ts';
