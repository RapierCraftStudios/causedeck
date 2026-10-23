// The inbox as the client receives it (#48): the read model of `getInbox` with dates as ISO
// strings, plus the "Ready to send" items the registered providers returned and the capture
// channels' opt-in state for the first-run screen. Plain data, so a server page can pass it.
import type { Inbox, InboxAnchor, InboxItem } from '@causedeck/core/automation';

import type { ReadyItem } from './ready-providers.ts';

export type { InboxAnchor };

export interface InboxItemView extends Omit<InboxItem, 'createdAt' | 'reassignUntil'> {
  createdAt: string;
  reassignUntil: string | null;
  /** When the public cause list this proposal was matched in was fetched (#482); null for other sources. */
  sourceFetchedAt?: string | null;
}

export interface ProcessingItemView {
  captureId: string;
  channel: string;
  status: 'received' | 'scanning' | 'queued' | 'processing';
  createdAt: string;
  /** Saved on this device, not yet sent: shows the offline badge. */
  localOnly: boolean;
}

export interface ChannelView {
  channel: 'share' | 'voice' | 'upload';
  enabled: boolean;
}

export interface InboxView {
  needsYou: InboxItemView[];
  ready: ReadyItem[];
  processing: ProcessingItemView[];
  channels: ChannelView[];
  /** The member may confirm, edit and dismiss. */
  canAct: boolean;
}

export const toItemView = (item: InboxItem): InboxItemView => ({
  ...item,
  createdAt: item.createdAt.toISOString(),
  reassignUntil: item.reassignUntil?.toISOString() ?? null,
});

export function toInboxView(inbox: Inbox, ready: ReadyItem[], channels: ChannelView[]): InboxView {
  return {
    needsYou: inbox.needsYou.map(toItemView),
    ready,
    processing: inbox.processing.map((row) => ({
      captureId: row.captureId,
      channel: row.channel,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      localOnly: false,
    })),
    channels,
    canAct: inbox.canAct,
  };
}

export interface InboxCounts {
  needsYou: number;
  ready: number;
  processing: number;
}

export const countsOf = (view: InboxView): InboxCounts => ({
  needsYou: view.needsYou.length,
  ready: view.ready.length,
  processing: view.processing.length,
});

/** `12 November 2026` in the member's language, for the live region (the toast uses `formatDate`). */
export function formatLongDate(isoDay: string, locale: string): string {
  return new Intl.DateTimeFormat(`${locale}-IN`, {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${isoDay}T00:00:00+05:30`));
}
