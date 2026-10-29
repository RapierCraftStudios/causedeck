'use client';
// The confirm step (#92): the import's confirm grid embedded. Each proposed matter can be approved,
// merged or split, and nothing is saved to the matter graph before the member confirms (L2). The
// plan is read from the batch the import step handed over (`?batch=`); with none, the step says
// there is nothing to confirm and the member skips on. After the plan is applied the step is
// complete and the grid's link leads to the first-day reveal.
import type { ImportPlan } from '@causedeck/core/import';
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Skeleton } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import {
  applyImportPlanAction,
  getImportPlanAction,
  saveImportPlanEditsAction,
  undoImportBatchAction,
  type ApplyView,
} from '../../app/(app)/w/[slug]/import/actions.ts';
import { confirmImport, type ConfirmInput } from '../../lib/import/plan-edit.ts';
import { ConfirmGrid } from '../import/confirm-grid.tsx';

import { StepActions } from './step-actions.tsx';
import { stepHref, type StepScope } from './steps.ts';
import { useStepSubmit } from './use-step-submit.ts';

export interface ConfirmStepProps {
  scope: StepScope;
  /** The batch the import step handed over; `null` when there is none. */
  batchId: string | null;
}

type Load = { kind: 'loading' } | { kind: 'ready'; plan: ImportPlan } | { kind: 'failed' };

export function ConfirmStep({ scope, batchId }: ConfirmStepProps) {
  const t = useTranslations('onboarding.confirm');
  const nav = useTranslations('onboarding.nav');
  const [load, setLoad] = useState<Load>(
    batchId === null ? { kind: 'failed' } : { kind: 'loading' },
  );
  const [attempt, setAttempt] = useState(0);
  const { submit, pending } = useStepSubmit(scope);

  useEffect(() => {
    if (batchId === null) return undefined;
    let current = true;
    void getImportPlanAction({ workspaceId: scope.workspaceId, batchId })
      .then((result) => {
        if (current) setLoad(result.ok ? { kind: 'ready', plan: result.data } : { kind: 'failed' });
      })
      .catch(() => {
        if (current) setLoad({ kind: 'failed' });
      });
    return () => {
      current = false;
    };
  }, [batchId, scope.workspaceId, attempt]);

  if (batchId === null) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-ink-muted">{t('noBatch')}</p>
        <StepActions
          type="button"
          label={nav('next')}
          pending={pending}
          onPrimary={() => void submit('confirm', undefined, true)}
        />
      </div>
    );
  }
  if (load.kind === 'loading') {
    return <Skeleton className="h-48 w-full" aria-label={t('intro')} />;
  }
  if (load.kind === 'failed') {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="danger" role="alert">
          {t('loadFailed')}
        </Alert>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => {
            setLoad({ kind: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          {t('retry')}
        </Button>
      </div>
    );
  }

  const { plan } = load;
  const confirm = async (input: ConfirmInput) => {
    const result = await confirmImport<ApplyView>(input, {
      plan,
      savePlan: (groups) =>
        saveImportPlanEditsAction({ workspaceId: scope.workspaceId, batchId, groups }),
      applyPlan: (decisions) =>
        applyImportPlanAction({ workspaceId: scope.workspaceId, batchId, decisions }),
    });
    if (result.ok) {
      // Applied: the step is complete and the resume point moves to the reveal. The grid keeps
      // showing its own summary; `Continue` below (or its court-day link) opens the reveal.
      void scope.completeStep({ workspaceId: scope.workspaceId, step: 'confirm' });
    }
    return result;
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-muted text-sm">{t('intro')}</p>
      <ConfirmGrid
        plan={plan}
        courtDayHref={stepHref(scope.path, 'done', scope.slug)}
        onConfirm={confirm}
        onUndo={() => undoImportBatchAction({ workspaceId: scope.workspaceId, batchId })}
        onAddIdentifiers={() => undefined}
        onRetryFile={() => undefined}
        onKeepFile={() => undefined}
      />
    </div>
  );
}
