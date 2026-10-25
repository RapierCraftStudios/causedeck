'use client';
// `Export` (#232): opens the export confirmation dialog, lazily so its code stays out of the
// page's first load. `E` opens it too, unless the user is typing or it is disabled (offline).
import { Button } from '@causedeck/ui/button';
import { useHotkey } from '@causedeck/ui/hooks';
import { Download } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';

import type { AuditFilterValues } from './filter-params.ts';

const ExportDialog = dynamic(() => import('./export-dialog.tsx').then((m) => m.ExportDialog), {
  ssr: false,
});

export interface ExportButtonProps {
  workspaceId: string;
  filters: AuditFilterValues;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportButton({
  workspaceId,
  filters,
  disabled = false,
  open,
  onOpenChange,
}: ExportButtonProps) {
  const t = useTranslations('audit.export');
  useHotkey(
    'e',
    () => {
      onOpenChange(true);
    },
    { enabled: !disabled && !open },
  );
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-keyshortcuts="E"
        disabled={disabled}
        onClick={() => {
          onOpenChange(true);
        }}
      >
        <Download aria-hidden="true" />
        {t('button')}
      </Button>
      {open ? (
        <ExportDialog workspaceId={workspaceId} filters={filters} onOpenChange={onOpenChange} />
      ) : null}
    </>
  );
}
