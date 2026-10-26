'use client';
// The conflict panel (#874, #87): the hits from `runConflictCheck` for one enquiry, to weigh. It
// never says "conflicted" or "clear": that call is the advocate's. The count is a live region; the
// decision (proceed, decline or refer) comes with an optional note and is the advocate's to make.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Field } from '@causedeck/ui/field';
import { Textarea } from '@causedeck/ui/textarea';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { ConflictCheckView } from '../../../../../../../lib/intake/intake-deps.ts';

export type ConflictDecision = 'proceed' | 'decline' | 'refer';

export interface ConflictPanelProps {
  result: ConflictCheckView | null;
  running: boolean;
  disabled: boolean;
  error: string | null;
  onDecide: (decision: ConflictDecision, note: string) => void;
}

export function ConflictPanel({ result, running, disabled, error, onDecide }: ConflictPanelProps) {
  const t = useTranslations('enquiry.conflict');
  const [note, setNote] = useState('');
  const count = result?.hits.length ?? 0;

  return (
    <section data-slot="conflict-panel" aria-label={t('title')} className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{t('title')}</h3>
      <p role="status" aria-live="polite" data-conflict-count={count} className="text-sm">
        {running ? t('running') : result === null ? t('notRun') : t('count', { count })}
      </p>
      {error === null ? null : (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {result !== null && count > 0 ? (
        <>
          <Alert tone="warning" data-slot="conflict-warning">
            {t('warning')}
          </Alert>
          <ul aria-label={t('hits')} className="flex flex-col gap-2">
            {result.hits.map((hit) => (
              <li
                key={`${hit.matterId}:${hit.checked}:${hit.side}`}
                data-conflict-hit={hit.matterId}
                className="border-line rounded-md border p-3 text-sm"
              >
                <p className="font-medium">{hit.matterTitle}</p>
                <p className="text-ink-muted">{t(`role.${hit.existingRole}`)}</p>
                <p>{hit.reason}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {result !== null && count === 0 ? (
        <p className="text-ink-muted text-sm">{t('noHits')}</p>
      ) : null}
      {result === null ? null : (
        <div className="flex flex-col gap-2">
          <Field label={t('note.label')} hint={t('note.hint')}>
            <Textarea
              data-conflict-field="note"
              value={note}
              maxLength={300}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {(['proceed', 'decline', 'refer'] as const).map((decision) => (
              <Button
                key={decision}
                type="button"
                variant={decision === 'proceed' ? 'default' : 'secondary'}
                data-conflict-decision={decision}
                disabled={disabled}
                onClick={() => {
                  onDecide(decision, note.trim());
                }}
              >
                {t(`decision.${decision}`)}
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
