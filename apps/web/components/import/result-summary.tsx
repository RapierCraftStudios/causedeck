'use client';
// What the import created (#551), the undo, and the way on: "Open your first court-day view".
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

export interface ResultSummaryProps {
  created: Readonly<Record<string, number>>;
  duplicates: number;
  unresolvedProceedingKeys: readonly string[];
  /** The court-day view the first output leads to. */
  courtDayHref: string;
  undoing: boolean;
  undone: boolean;
  undoFailed: boolean;
  onUndo: () => void;
}

export function ResultSummary({
  created,
  duplicates,
  unresolvedProceedingKeys,
  courtDayHref,
  undoing,
  undone,
  undoFailed,
  onUndo,
}: ResultSummaryProps) {
  const t = useTranslations('bootstrapImport');
  return (
    <section
      aria-labelledby="import-result-title"
      data-slot="result-summary"
      className="flex flex-col gap-3"
    >
      <h2 id="import-result-title" className="text-ink text-lg font-semibold">
        {t('result.title')}
      </h2>
      <p role="status">
        {t('result.created', {
          matters: created['matters'] ?? 0,
          proceedings: created['proceedings'] ?? 0,
          hearings: created['hearings'] ?? 0,
          documents: created['documents'] ?? 0,
        })}
      </p>
      {duplicates > 0 ? (
        <p className="text-ink-muted text-sm">{t('result.duplicates', { count: duplicates })}</p>
      ) : null}
      {unresolvedProceedingKeys.length > 0 ? (
        <p className="text-ink-muted text-sm">
          {t('result.unresolved', { count: unresolvedProceedingKeys.length })}
        </p>
      ) : null}
      {undoFailed ? (
        <Alert tone="danger" role="alert">
          {t('result.undoFailed')}
        </Alert>
      ) : null}
      {undone ? (
        <p role="status">{t('result.undone')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={courtDayHref}>{t('result.next')}</Link>
          </Button>
          <Button type="button" variant="ghost" disabled={undoing} onClick={onUndo}>
            {undoing ? t('result.undoing') : t('result.undo')}
          </Button>
        </div>
      )}
    </section>
  );
}
