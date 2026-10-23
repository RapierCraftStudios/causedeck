'use client';
// Per-file type, size and status of the bootstrap import (#552).
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';

import { MAX_IMPORT_FILES, type ImportEntry } from '../../lib/import/file-rules.ts';

export interface FileListProps {
  entries: readonly ImportEntry[];
  onRetry: (id: string) => void;
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

export function FileList({ entries, onRetry }: FileListProps) {
  const t = useTranslations('bootstrapImport');
  return (
    <section aria-labelledby="import-files-heading" className="flex flex-col gap-2">
      <h2 id="import-files-heading" className="text-sm font-medium">
        {t('list.title')}{' '}
        <span className="text-muted-foreground font-normal">
          {t('list.summary', { n: entries.length, max: MAX_IMPORT_FILES })}
        </span>
      </h2>
      <ul className="divide-y rounded-md border" data-slot="import-file-list">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate" title={entry.name}>
              {entry.name}
            </span>
            <span className="text-muted-foreground w-12 uppercase">{entry.type ?? '-'}</span>
            <span className="text-muted-foreground w-16 text-right">
              {sizeLabel(entry.sizeBytes)}
            </span>
            <Badge
              data-status={entry.status}
              tone={entry.status === 'failed' || entry.status === 'rejected' ? 'danger' : 'neutral'}
            >
              {t(`list.status.${entry.status}`)}
            </Badge>
            {entry.reason === undefined ? null : (
              <span className="text-muted-foreground max-w-56 text-xs">
                {t(`list.reason.${entry.reason}`)}
              </span>
            )}
            {entry.status === 'failed' ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  onRetry(entry.id);
                }}
              >
                {t('list.retry')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
