'use client';
// The import step (#92): three lanes (Forward, Share, Upload) and nothing to retype. The Upload
// lane is the bootstrap import (#552): files go up as `bulk_import` captures and each shows its
// progress; when the plan is ready the wizard moves to the confirm step. Skipping is always
// allowed and lands on a guided board with the demo workspace one click away. Offline pauses the
// network lanes with an explanation, and a role that cannot edit matters sees who can.
import { Alert } from '@causedeck/ui/alert';
import { WifiOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useOnline } from '../settings/settings-offline-banner.tsx';
import { BootstrapImport } from '../import/bootstrap-import.tsx';

import { ForwardInstructions, type ForwardInstructionsProps } from './forward-instructions.tsx';
import { StepActions } from './step-actions.tsx';
import { stepHref, type StepScope } from './steps.ts';
import { useStepSubmit } from './use-step-submit.ts';

export interface ImportStepProps {
  scope: StepScope;
  forward: Omit<ForwardInstructionsProps, 'disabled'>;
  channelEnabled: boolean;
  canEnableChannel: boolean;
  disclosureVersion: string;
}

export function ImportStep({
  scope,
  forward,
  channelEnabled,
  canEnableChannel,
  disclosureVersion,
}: ImportStepProps) {
  const t = useTranslations('onboarding.import');
  const router = useRouter();
  const online = useOnline();
  const { submit, pending } = useStepSubmit(scope);

  return (
    <div className="flex flex-col gap-6">
      {!online ? (
        <Alert tone="warning" icon={<WifiOff />} data-pattern-state="offline">
          {t('offline')}
        </Alert>
      ) : null}
      <section aria-labelledby="lane-forward" className="flex flex-col gap-2">
        <h2 id="lane-forward" className="text-lg font-medium">
          {t('lanes.forward.title')}
        </h2>
        <ForwardInstructions {...forward} disabled={!online} />
      </section>
      <section aria-labelledby="lane-share" className="flex flex-col gap-2">
        <h2 id="lane-share" className="text-lg font-medium">
          {t('lanes.share.title')}
        </h2>
        <p className="text-ink-muted text-sm">{t('lanes.share.body')}</p>
        <p className="text-ink-muted text-sm">{t('lanes.share.hint')}</p>
      </section>
      <section aria-labelledby="lane-upload" className="flex flex-col gap-2">
        <h2 id="lane-upload" className="text-lg font-medium">
          {t('lanes.upload.title')}
        </h2>
        <p className="text-ink-muted text-sm">{t('lanes.upload.body')}</p>
        {online ? (
          <BootstrapImport
            workspaceId={scope.workspaceId}
            channelEnabled={channelEnabled}
            canEnableChannel={canEnableChannel}
            disclosureVersion={disclosureVersion}
            onPlanReady={(batchId) => {
              // The import is done once its plan is ready: save that as the resume point, then
              // hand the batch to the confirm step.
              void scope
                .completeStep({ workspaceId: scope.workspaceId, step: 'import' })
                .finally(() => {
                  router.push(stepHref(scope.path, 'confirm', scope.slug, batchId));
                });
            }}
          />
        ) : null}
      </section>
      <p className="text-ink-muted text-sm">{t('skipNote')}</p>
      <StepActions
        type="button"
        label={t('continueEmpty')}
        pending={pending}
        onPrimary={() => void submit('import', undefined, true)}
      />
    </div>
  );
}
