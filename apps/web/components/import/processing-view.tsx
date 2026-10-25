'use client';
// Progress of a bootstrap import batch (#552): files read, the plan-ready, nothing-recognised and
// partial-failure states, and the free-plan cap message. Counts only, never file content.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Progress } from '@causedeck/ui/progress';
import { useTranslations } from 'next-intl';

import type { ImportProgressView } from '../../app/(app)/w/[slug]/import/actions.ts';

export interface ProcessingViewProps {
  progress: ImportProgressView;
  retrying: boolean;
  onRetryFailed: () => void;
  onReview?: (() => void) | undefined;
}

export function ProcessingView({
  progress,
  retrying,
  onRetryFailed,
  onReview,
}: ProcessingViewProps) {
  const t = useTranslations('bootstrapImport');
  const { files, total } = progress;
  const failedFiles = files['failed'] ?? 0;
  const done = (files['parsed'] ?? 0) + (files['unmatched'] ?? 0) + failedFiles;
  const finished = progress.status === 'ready' || progress.status === 'failed';
  const nothing = progress.status === 'ready' && progress.matchedRows === 0;

  return (
    <section
      aria-labelledby="import-processing-heading"
      data-slot="import-processing"
      className="flex flex-col gap-3"
    >
      <h2 id="import-processing-heading" className="text-sm font-medium">
        {t('processing.title')}
      </h2>
      <Progress
        aria-label={t('processing.progress', { done, total })}
        value={done}
        max={Math.max(total, 1)}
      />
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {t('processing.progress', { done, total })}
      </p>
      {progress.keptAsAttachments > 0 ? (
        <Alert tone="info" data-pattern-state="plan-cap">
          {t('processing.kept', { n: progress.keptAsAttachments })}
        </Alert>
      ) : null}
      {failedFiles > 0 || progress.status === 'failed' ? (
        <Alert tone="warning" data-pattern-state="partial-failure">
          <p>{t('processing.failed', { n: failedFiles > 0 ? failedFiles : Math.max(total, 1) })}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={retrying}
            onClick={onRetryFailed}
          >
            {t('processing.retry')}
          </Button>
        </Alert>
      ) : null}
      {finished && nothing ? (
        <Alert tone="neutral" data-pattern-state="nothing-recognised">
          {t('processing.nothing')}
        </Alert>
      ) : null}
      {progress.status === 'ready' && !nothing ? (
        <Alert tone="success" data-pattern-state="plan-ready">
          <p>{t('processing.ready', { n: progress.matchedRows })}</p>
          {onReview === undefined ? null : (
            <Button type="button" size="sm" onClick={onReview}>
              {t('processing.review')}
            </Button>
          )}
        </Alert>
      ) : null}
    </section>
  );
}
