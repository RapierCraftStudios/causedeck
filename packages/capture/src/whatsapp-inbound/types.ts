// The inbound WhatsApp seam (#680, part 3 of #502). A provider authenticates what the transport
// delivered (a signed Meta Cloud API webhook) and turns it into media messages, and downloads the
// media by its provider reference. It never parses a document and keeps no state: who the sender
// is, what is stored and what is dropped is decided by the `whatsapp-link` domain.

/** One forwarded media message: who sent it, its provider id, and what the provider says it is. */
export interface WhatsAppInboundMessage {
  /** The provider's message id (`wamid...`); the dedupe key within a workspace. */
  providerMessageId: string;
  /** The sender's number in E.164 (`+919800000001`). */
  from: string;
  /** The provider's reference to the media; `fetchMedia` understands it. */
  mediaId: string;
  /** The declared MIME type, parameters included (`audio/ogg; codecs=opus`). */
  mime: string;
  /** The declared filename; empty for a voice note. */
  filename: string;
}

export interface WhatsAppInboundRequest {
  /** Header names lower-case. */
  headers: Readonly<Record<string, string | undefined>>;
  /** The raw request body, unparsed. */
  body: string;
}

export type WhatsAppInboundVerification =
  { ok: true; messages: WhatsAppInboundMessage[] } | { ok: false; reason: string };

/** Thrown by `fetchMedia` when the media is larger than the cap it was given. */
export class WhatsAppMediaTooLargeError extends Error {
  override name = 'WhatsAppMediaTooLargeError';

  constructor() {
    super('whatsapp media is too large');
  }
}

export interface WhatsAppInboundProvider {
  id: 'meta';
  /** Authenticates the request and extracts its media messages; never throws for bad input. */
  verify(request: WhatsAppInboundRequest): Promise<WhatsAppInboundVerification>;
  /** The `hub.challenge` answer for the subscription handshake, or null when the token is wrong. */
  challenge(query: { mode?: string; verifyToken?: string; challenge?: string }): string | null;
  /** Downloads the media; throws once it is larger than `maxBytes`. */
  fetchMedia(mediaId: string, maxBytes: number): Promise<Uint8Array>;
}
