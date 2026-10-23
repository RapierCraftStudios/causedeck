// The WhatsApp import domain (#526; PRD CA-6): `receiveWhatsAppImport` (the `whatsapp_export`
// intake: validateSelection, selected messages only) and `runWhatsAppImport` (the `whatsapp.import`
// job body: the `structure_chat` task, anchored proposals, the 30-day raw-text clock). Parsing,
// rules and the pure structuring live in `@causedeck/capture`. Not re-exported from the package root.
export {
  mediaKindOf,
  rebuildExportText,
  safeMediaName,
  WhatsAppImportInput,
  type StoredChat,
  type StoredChatMessage,
  type WhatsAppImportMessage,
} from './payload.ts';
export { receiveWhatsAppImport, type ReceivedWhatsAppImport } from './receive.ts';
export { runWhatsAppImport, type WhatsAppImportDeps, type WhatsAppImportOutcome } from './run.ts';
