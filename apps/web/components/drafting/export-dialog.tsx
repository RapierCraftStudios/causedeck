'use client';

// The export dialog (#828): DOCX or PDF of the current version, the court format it will use and
// whether the draft has AI-assisted text. Export is off while a not-found citation is
// unacknowledged (the dialog offers the acknowledgement instead). `onExport` queues the file and
// resolves its presigned link; the link is shown to click. There is no send, share-by-email or file
// button: the file only ever goes to the person who asked for it.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { EXPORT_FORMATS, type ExportFormat } from '@causedeck/validators/drafting';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export interface ExportLink {
  url: string;
  filename: string;
}

export interface DraftExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The template's court preset key, or null when it has none. */
  courtPreset: string | null;
  aiAssisted: boolean;
  /** Not-found citations nobody acknowledged; any blocks the export. */
  unacknowledged: number;
  disabled?: boolean;
  onAcknowledge: () => void;
  /** Resolves the download link, or null when the export failed. */
  onExport: (format: ExportFormat) => Promise<ExportLink | null>;
}

export function DraftExportDialog({
  open,
  onOpenChange,
  courtPreset,
  aiAssisted,
  unacknowledged,
  disabled = false,
  onAcknowledge,
  onExport,
}: DraftExportDialogProps) {
  const t = useTranslations('drafting.export');
  const tc = useTranslations('drafting.checks.export');
  const [format, setFormat] = useState<ExportFormat>('docx');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<ExportLink | null>(null);
  const [failed, setFailed] = useState(false);

  async function run() {
    setBusy(true);
    setFailed(false);
    setLink(null);
    const result = await onExport(format);
    setBusy(false);
    if (result === null) setFailed(true);
    else setLink(result);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="export-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{tc('description')}</DialogDescription>
        </DialogHeader>
        <fieldset className="flex gap-2">
          <legend className="sr-only">{tc('format')}</legend>
          {EXPORT_FORMATS.map((value) => (
            <Button
              key={value}
              type="button"
              variant="outline"
              aria-pressed={format === value}
              className="aria-pressed:bg-surface-sunken aria-pressed:border-line-strong"
              onClick={() => {
                setFormat(value);
                setLink(null);
              }}
            >
              {t(value)}
            </Button>
          ))}
        </fieldset>
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-ink-muted">{tc('court')}</dt>
            <dd data-export-court="">
              {courtPreset === null ? tc('noCourt') : courtPreset.replaceAll('_', ' ')}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-muted">{tc('ai')}</dt>
            <dd data-export-ai={aiAssisted ? 'yes' : 'no'}>
              {aiAssisted ? tc('aiYes') : tc('aiNo')}
            </dd>
          </div>
        </dl>
        {unacknowledged > 0 ? (
          <Alert tone="warning" role="status">
            {t('unverifiedWarning', { count: unacknowledged })}{' '}
            <Button type="button" size="sm" variant="link" onClick={onAcknowledge}>
              {tc('acknowledge')}
            </Button>
          </Alert>
        ) : null}
        {failed ? (
          <Alert tone="danger" role="alert">
            {t('failed')}
          </Alert>
        ) : null}
        {link === null ? null : (
          <a
            href={link.url}
            download={link.filename}
            className="text-accent text-sm underline underline-offset-4"
          >
            {tc('download', { filename: link.filename })}
          </a>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {tc('close')}
          </Button>
          <Button
            type="button"
            disabled={disabled || busy || unacknowledged > 0}
            onClick={() => void run()}
          >
            {busy ? tc('preparing') : t('action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
