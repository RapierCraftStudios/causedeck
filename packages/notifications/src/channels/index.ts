// Outbound channels beyond email and web push: WhatsApp Business (#679).
export {
  buildTemplateBody,
  createWhatsAppSender,
  hasWhatsAppTemplate,
  whatsappConfig,
  WHATSAPP_CATEGORIES,
  WHATSAPP_TEMPLATES,
  WhatsAppDeliveryError,
  type WhatsAppCategory,
  type WhatsAppConfig,
  type WhatsAppEnv,
  type WhatsAppFetch,
  type WhatsAppLogger,
  type WhatsAppMessage,
  type WhatsAppSender,
  type WhatsAppSenderOptions,
  type WhatsAppTarget,
} from './whatsapp.ts';
