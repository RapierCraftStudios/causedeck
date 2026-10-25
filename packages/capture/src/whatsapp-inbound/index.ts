// Inbound WhatsApp forward-in (#680): the provider seam, the Meta Cloud API provider and the media
// type allow-list. Who the sender is and what is stored is the `whatsapp-link` domain's.
export { resolveWhatsAppMedia, type WhatsAppMedia } from './allow-list.ts';
export {
  createMetaWhatsAppProvider,
  parseMetaMessages,
  type MetaWhatsAppConfig,
} from './meta.ts';
export {
  WhatsAppMediaTooLargeError,
  type WhatsAppInboundMessage,
  type WhatsAppInboundProvider,
  type WhatsAppInboundRequest,
  type WhatsAppInboundVerification,
} from './types.ts';
