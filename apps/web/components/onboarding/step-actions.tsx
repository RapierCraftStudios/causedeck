// The step's actions (#92): one primary button (sticky to the bottom of the screen on a phone, so
// the thumb reaches it) and, where a step may be skipped, a text button. The primary button carries
// `data-onboarding-primary`, which the shell's Enter handler presses outside a field.
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export interface StepActionsProps {
  /** The primary button's label. */
  label: ReactNode;
  pending?: boolean;
  disabled?: boolean;
  /** Present on a skippable step. */
  onSkip?: (() => void) | undefined;
  /** `submit` for a form's own button; `button` with `onPrimary` otherwise. */
  type?: 'submit' | 'button';
  onPrimary?: (() => void) | undefined;
}

export function StepActions({
  label,
  pending = false,
  disabled = false,
  onSkip,
  type = 'submit',
  onPrimary,
}: StepActionsProps) {
  const t = useTranslations('onboarding.nav');
  return (
    <div
      data-slot="step-actions"
      className="bg-surface border-line sticky bottom-0 -mx-5 mt-2 flex flex-col gap-2 border-t px-5 py-3 md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0"
    >
      <Button
        type={type}
        size="lg"
        data-onboarding-primary=""
        loading={pending}
        labels={{ loading: t('saving') }}
        disabled={disabled}
        onClick={onPrimary}
        className="w-full"
      >
        {label}
      </Button>
      {onSkip ? (
        <Button type="button" variant="link" size="lg" disabled={pending} onClick={onSkip}>
          {t('skip')}
        </Button>
      ) : null}
    </div>
  );
}
