// The WhatsApp number link (#678, part 1 of #502, D-029): a member requests a one-time code to a
// number, opts in, verifies it, picks the categories and can unlink. Messages may only ever target
// the verified number of the owning user (`getWhatsAppSendTarget`). Sending is a later part (#679).
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
