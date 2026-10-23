// The voice recorder's write to the encrypted outbox (#543). The recording is one file stored,
// encrypted, the moment it stops (before any network call); the outbox sync loop uploads it on the
// `voice` channel when online, and again on reconnect without user action.
import type { OutboxItem, OutboxStore } from '../../pwa/outbox/db.ts';
import { enqueueFiles, notifyOutboxChanged } from '../../pwa/outbox/queue.ts';

import { baseMime, extensionFor } from './recorder.ts';

export interface SaveRecordingOptions {
  workspaceId: string | null;
  matterHintId?: string | undefined;
  capBytes?: number | undefined;
  now?: number | undefined;
}

/** Store a recording, encrypted. Throws `OutboxCapError` (nothing stored) when it would not fit. */
export async function saveRecording(
  store: OutboxStore,
  key: CryptoKey,
  recording: { blob: Blob; mime: string },
  options: SaveRecordingOptions,
): Promise<OutboxItem> {
  const type = baseMime(recording.mime);
  const stamp = new Date(options.now ?? Date.now()).toISOString().replace(/[:.]/g, '-');
  const file = new File([recording.blob], `voice-${stamp}.${extensionFor(type)}`, { type });
  const { items } = await enqueueFiles(store, key, [file], {
    workspaceId: options.workspaceId,
    channel: 'voice',
    matterHintId: options.matterHintId,
    capBytes: options.capBytes,
    now: options.now,
  });
  notifyOutboxChanged();
  return items[0] as OutboxItem;
}
