// Browser side of `POST /api/captures/whatsapp` (#526, #527): sends the selected payload and maps
// the response to a failure the flow words for the user. Client-safe: no server imports.
import type { WhatsAppUploadPayload } from './payload.ts';

export const WHATSAPP_CAPTURE_PATH = '/api/captures/whatsapp';

export type WhatsAppUploadFailure =
  'forbidden' | 'not_found' | 'too_large' | 'invalid' | 'rate_limited' | 'failed';

export type WhatsAppUploadResult = { ok: true } | { ok: false; error: WhatsAppUploadFailure };

const FAILURE_BY_STATUS: Readonly<Record<number, WhatsAppUploadFailure>> = {
  400: 'invalid',
  403: 'forbidden',
  404: 'not_found',
  413: 'too_large',
  415: 'invalid',
  429: 'rate_limited',
};

export async function uploadWhatsAppImport(
  payload: WhatsAppUploadPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppUploadResult> {
  try {
    const response = await fetchImpl(WHATSAPP_CAPTURE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) return { ok: true };
    return { ok: false, error: FAILURE_BY_STATUS[response.status] ?? 'failed' };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
