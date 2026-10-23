'use client';
// The issues panel (#551): what needs a look before confirming, each with one action. Plan issues
// (low confidence, conflicting dates) come from the plan; missing identifiers, unreadable files and
// documents that only a dedicated adapter can read come from the batch's files. An unreadable file
// uses the standard recovery copy.
import { Button } from '@causedeck/ui/button';
import { AlertTriangle, FileQuestion, GitCompare, IdCard, Paperclip } from 'lucide-react';
import { useTranslations } from 'next-intl';

export type PanelIssue =
  | { kind: 'low_confidence'; matterId: string; title: string }
  | { kind: 'conflicting_dates'; matterId: string; title: string }
  | { kind: 'missing_identifiers' }
  | { kind: 'unreadable_file'; fileId: string; name: string }
  | { kind: 'a0_only'; fileId: string; name: string };

export interface IssuesPanelProps {
  issues: readonly PanelIssue[];
  disabled?: boolean;
  onFocusMatter: (matterId: string) => void;
  onAddIdentifiers: () => void;
  onRetryFile: (fileId: string) => void;
  onKeepFile: (fileId: string) => void;
}

export const issueId = (issue: PanelIssue): string =>
  'matterId' in issue
    ? `${issue.kind}:${issue.matterId}`
    : 'fileId' in issue
      ? `${issue.kind}:${issue.fileId}`
      : issue.kind;

export function IssuesPanel({
  issues,
  disabled = false,
  onFocusMatter,
  onAddIdentifiers,
  onRetryFile,
  onKeepFile,
}: IssuesPanelProps) {
  const t = useTranslations('importReview');
  return (
    <section
      aria-labelledby="import-issues-title"
      data-slot="issues-panel"
      className="flex flex-col gap-2"
    >
      <h2 id="import-issues-title" className="text-ink text-base font-semibold">
        {t('issues.title')}
      </h2>
      {issues.length === 0 ? (
        <p className="text-ink-muted text-sm">{t('issues.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {issues.map((issue) => (
            <li
              key={issueId(issue)}
              data-issue={issue.kind}
              className="border-line flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
            >
              {issue.kind === 'low_confidence' ? (
                <>
                  <AlertTriangle aria-hidden className="text-warning size-4" />
                  <span className="flex-1">
                    {t('issues.lowConfidence', { title: issue.title })}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onFocusMatter(issue.matterId);
                    }}
                  >
                    {t('issues.review')}
                  </Button>
                </>
              ) : null}
              {issue.kind === 'conflicting_dates' ? (
                <>
                  <GitCompare aria-hidden className="text-danger size-4" />
                  <span className="flex-1">
                    {t('issues.conflictingDates', { title: issue.title })}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onFocusMatter(issue.matterId);
                    }}
                  >
                    {t('issues.pickDate')}
                  </Button>
                </>
              ) : null}
              {issue.kind === 'missing_identifiers' ? (
                <>
                  <IdCard aria-hidden className="text-warning size-4" />
                  <span className="flex-1">{t('issues.missingIdentifiers')}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={onAddIdentifiers}
                  >
                    {t('issues.addIdentifiers')}
                  </Button>
                </>
              ) : null}
              {issue.kind === 'unreadable_file' ? (
                <>
                  <FileQuestion aria-hidden className="text-danger size-4" />
                  <span className="flex-1">
                    {t('issues.unreadable', { name: issue.name })}
                    <span className="text-ink-muted block">{t('issues.unreadableCopy')}</span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => {
                      onRetryFile(issue.fileId);
                    }}
                  >
                    {t('issues.retry')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => {
                      onKeepFile(issue.fileId);
                    }}
                  >
                    {t('issues.keep')}
                  </Button>
                </>
              ) : null}
              {issue.kind === 'a0_only' ? (
                <>
                  <Paperclip aria-hidden className="text-ink-muted size-4" />
                  <span className="flex-1">{t('issues.a0Only', { name: issue.name })}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => {
                      onKeepFile(issue.fileId);
                    }}
                  >
                    {t('issues.keep')}
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
