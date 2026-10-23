'use client';
// The preview step of the WhatsApp import (#527): search, bulk actions, a live count and the
// virtualised list. Everything here is local state; the upload happens from the parent.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { useTranslations } from 'next-intl';
import { useDeferredValue, useMemo, useState } from 'react';

import { MAX_IMPORT_MESSAGES } from '../../../lib/inbox/whatsapp-import/payload.ts';
import {
  clearShown,
  confirmHeld,
  excludeHeld,
  matchesSearch,
  selectShown,
  toggle,
} from '../../../lib/inbox/whatsapp-import/selection.ts';
import type { ParsedChat } from '../../../lib/inbox/whatsapp-import/types.ts';

import { MessageList } from './message-list.tsx';

export interface ReviewState {
  selected: Set<string>;
  confirmed: Set<string>;
}

export interface ReviewStepProps {
  chat: ParsedChat;
  state: ReviewState;
  onChange: (state: ReviewState) => void;
  onFlipDateOrder: () => void;
}

export function ReviewStep({ chat, state, onChange, onFlipDateOrder }: ReviewStepProps) {
  const t = useTranslations('whatsappImport.preview');
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const shown = useMemo(
    () => chat.rows.filter((row) => matchesSearch(row, deferred)),
    [chat.rows, deferred],
  );
  const { selected, confirmed } = state;

  return (
    <div className="grid gap-3">
      <h2 className="text-ink text-lg font-medium">{t('title')}</h2>
      <p className="text-ink-muted text-xs">
        {chat.dateOrderAmbiguous ? t('dateOrderAmbiguous') : t('dateOrder')}{' '}
        <Button variant="link" size="sm" onClick={onFlipDateOrder}>
          {t('flip')}
        </Button>
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid flex-1 gap-1 text-sm" style={{ minWidth: '12rem' }}>
          <span className="text-ink-muted text-xs">{t('search')}</span>
          <Input
            type="search"
            value={query}
            placeholder={t('searchPlaceholder')}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onChange({ selected: selectShown(selected, confirmed, shown), confirmed });
          }}
        >
          {t('selectShown')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onChange({ selected: clearShown(selected, shown), confirmed });
          }}
        >
          {t('clearShown')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onChange(excludeHeld(selected, chat.rows));
          }}
        >
          {t('excludeHeld')}
        </Button>
      </div>
      <p role="status" aria-live="polite" data-slot="whatsapp-count" className="text-ink text-sm">
        {t('summary', { kept: selected.size, total: chat.rows.length })}
      </p>
      {selected.size >= MAX_IMPORT_MESSAGES ? (
        <Alert tone="info">{t('limit', { max: MAX_IMPORT_MESSAGES })}</Alert>
      ) : null}
      <p className="text-ink-muted text-xs">{t('keys')}</p>
      {shown.length === 0 ? (
        <p className="text-ink-muted text-sm">{t('noMatches')}</p>
      ) : (
        <MessageList
          rows={shown}
          selected={selected}
          confirmed={confirmed}
          onToggle={(row) => {
            onChange({ selected: toggle(selected, confirmed, row), confirmed });
          }}
          onConfirm={(row) => {
            onChange(confirmHeld(selected, confirmed, row));
          }}
        />
      )}
    </div>
  );
}
