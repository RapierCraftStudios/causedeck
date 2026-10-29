'use client';
// How a draft leaves the app (#736, ADR 0045): copy, open `wa.me` / `mailto:` in the lawyer's own
// app, or download. Each is a click by the lawyer; the server is only told afterwards that they
// shared it. Sticky at the bottom on a phone. Disabled with a reason when offline or view-only.
import { Button } from '@causedeck/ui/button';
import type { ShareChannel } from '@causedeck/validators/outward-draft';
import { Check, Copy, Download, ExternalLink, Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  downloadText,
  draftFileName,
  mailtoHref,
  openExternal,
  whatsappHref,
} from '../../lib/outward/share-links.ts';

export interface ShareMenuProps {
  text: string;
  matterTitle: string;
  offline: boolean;
  readOnly: boolean;
  /** Called after a hand-off; records that the lawyer shared it. */
  onShared: (channel: ShareChannel) => void | Promise<void>;
  /** Called after the text was copied to the clipboard (or the copy failed). */
  onCopied?: (ok: boolean) => void;
}

export async function copyDraft(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ShareMenu({
  text,
  matterTitle,
  offline,
  readOnly,
  onShared,
  onCopied,
}: ShareMenuProps) {
  const t = useTranslations('outward');
  const recordDisabled = offline || readOnly;
  return (
    <div
      role="group"
      aria-label={t('share.label')}
      data-slot="share-menu"
      className="bg-surface-raised border-line sticky bottom-0 grid gap-2 border-t p-3 sm:static sm:rounded-xl sm:border"
    >
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          className="pointer-coarse:min-h-11"
          onClick={() => {
            void copyDraft(text).then((ok) => onCopied?.(ok));
          }}
        >
          <Copy aria-hidden="true" />
          {t('share.copy')}
        </Button>
        <Button
          variant="secondary"
          disabled={recordDisabled}
          className="pointer-coarse:min-h-11"
          onClick={() => {
            openExternal(whatsappHref(text));
            void onShared('whatsapp_link');
          }}
        >
          <ExternalLink aria-hidden="true" />
          {t('share.whatsapp')}
        </Button>
        <Button
          variant="secondary"
          disabled={recordDisabled}
          className="pointer-coarse:min-h-11"
          onClick={() => {
            openExternal(mailtoHref(t('share.emailSubject', { matter: matterTitle }), text));
            void onShared('mailto');
          }}
        >
          <Mail aria-hidden="true" />
          {t('share.email')}
        </Button>
        <Button
          variant="secondary"
          disabled={recordDisabled}
          className="pointer-coarse:min-h-11"
          onClick={() => {
            downloadText(text, draftFileName(matterTitle));
            void onShared('download');
          }}
        >
          <Download aria-hidden="true" />
          {t('share.download')}
        </Button>
        <Button
          disabled={recordDisabled}
          className="pointer-coarse:min-h-11"
          onClick={() => void onShared('clipboard')}
        >
          <Check aria-hidden="true" />
          {t('share.markShared')}
        </Button>
      </div>
      <p className="text-ink-muted text-xs">
        {recordDisabled ? (offline ? t('offline') : t('readOnly')) : t('share.note')}
      </p>
    </div>
  );
}
