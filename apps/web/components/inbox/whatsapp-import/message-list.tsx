'use client';
// The preview list of the WhatsApp import (#527): a virtualised list (only the rows in view are in
// the DOM, so 10,000 messages stay light), a checkbox per message, PII badges with a per-message
// confirm, and keyboard support: Up/Down move between messages, Space includes or excludes, C
// confirms a held message.
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { Checkbox } from '@causedeck/ui/checkbox';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Lock, Paperclip } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, type KeyboardEvent } from 'react';

import { isReleasable } from '../../../lib/inbox/whatsapp-import/payload.ts';
import { isHeld } from '../../../lib/inbox/whatsapp-import/selection.ts';
import type { ImportRow } from '../../../lib/inbox/whatsapp-import/types.ts';

export interface MessageListProps {
  rows: readonly ImportRow[];
  selected: ReadonlySet<string>;
  confirmed: ReadonlySet<string>;
  onToggle: (row: ImportRow) => void;
  onConfirm: (row: ImportRow) => void;
}

const ROW_ESTIMATE = 84;

export function MessageList({ rows, selected, confirmed, onToggle, onConfirm }: MessageListProps) {
  const t = useTranslations('whatsappImport');
  const parent = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 8,
  });

  function focusRow(index: number) {
    virtualizer.scrollToIndex(index);
    requestAnimationFrame(() => {
      parent.current
        ?.querySelector<HTMLElement>(`[data-row="${String(index)}"] button:not([disabled])`)
        ?.focus();
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const holder = (event.target as HTMLElement).closest<HTMLElement>('[data-row]');
    if (holder === null) return;
    const index = Number(holder.dataset.row);
    if (event.key === 'ArrowDown' && index + 1 < rows.length) {
      event.preventDefault();
      focusRow(index + 1);
    } else if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      focusRow(index - 1);
    } else if (event.key.toLowerCase() === 'c' && !event.metaKey && !event.ctrlKey) {
      const row = rows[index];
      if (row !== undefined && isHeld(row)) {
        event.preventDefault();
        onConfirm(row);
      }
    }
  }

  return (
    <div
      ref={parent}
      role="list"
      aria-label={t('preview.title')}
      data-slot="whatsapp-message-list"
      onKeyDown={onKeyDown}
      className="border-line bg-surface-raised h-[60vh] overflow-auto rounded-xl border"
    >
      <div style={{ height: virtualizer.getTotalSize() }} className="relative w-full">
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (row === undefined) return null;
          const held = isHeld(row);
          const releasable = isReleasable(row);
          const isConfirmed = confirmed.has(row.id);
          const time = row.ts.replace('T', ' ').slice(0, 16);
          return (
            <div
              key={row.id}
              role="listitem"
              ref={virtualizer.measureElement}
              data-index={item.index}
              data-row={item.index}
              data-held={held ? '' : undefined}
              style={{ transform: `translateY(${String(item.start)}px)` }}
              className="border-line absolute top-0 left-0 flex w-full gap-3 border-b p-3"
            >
              <Checkbox
                checked={selected.has(row.id)}
                disabled={held && !isConfirmed}
                onCheckedChange={() => {
                  onToggle(row);
                }}
                aria-label={t('preview.select', { sender: row.sender, time })}
              />
              <div className="grid min-w-0 flex-1 gap-1">
                <div className="text-ink-muted flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-ink font-medium">{row.sender}</span>
                  <time dateTime={row.ts}>{time}</time>
                  {row.rules.map((rule) => (
                    <Badge key={rule} tone="warning">
                      {t(`pii.${rule}`)}
                    </Badge>
                  ))}
                </div>
                <p className="text-ink line-clamp-3 text-sm break-words whitespace-pre-wrap">
                  {row.text}
                </p>
                {row.mediaRef === undefined ? null : (
                  <p className="text-ink-muted flex items-center gap-1 text-xs">
                    <Paperclip aria-hidden="true" className="size-3" />
                    {t('preview.attachment', { name: row.mediaRef })}
                  </p>
                )}
              </div>
              {held ? (
                releasable ? (
                  <Button
                    size="sm"
                    variant={isConfirmed ? 'secondary' : 'outline'}
                    aria-pressed={isConfirmed}
                    onClick={() => {
                      onConfirm(row);
                    }}
                  >
                    {isConfirmed ? t('pii.confirmed') : t('pii.confirm')}
                  </Button>
                ) : (
                  <span className="text-ink-muted flex items-center gap-1 text-xs">
                    <Lock aria-hidden="true" className="size-3" />
                    {t('pii.locked')}
                  </span>
                )
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
