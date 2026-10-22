// Turning the `email` capture channel on (#54 part 2). The plain-language note is the product
// copy of docs/product/09 §8; the settings page shows it (i18n `email-intake` namespace carries
// the same text per locale) and the member's confirmation goes through `enableChannel`, which
// records the disclosure version and audits `capture.channel_enabled`.
import { enableChannel, CAPTURE_DISCLOSURE_VERSION, type CaptureCtx } from '../capture/index.ts';
import type { ChannelState } from '../capture/index.ts';

export const EMAIL_CHANNEL_DISCLOSURE =
  'Forwarded emails are processed in India. Forward only what you want CauseDeck to read. Client emails are excluded unless you choose to forward them.';

/** Enable the `email` channel with the current disclosure version (needs `workspace.manage`). */
export function enableEmailChannel(ctx: CaptureCtx): Promise<ChannelState> {
  return enableChannel(ctx, { channel: 'email', disclosureVersion: CAPTURE_DISCLOSURE_VERSION });
}
