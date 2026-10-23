'use client';
// Why the microphone is needed, shown before the first recording (#543), and the actionable
// state when it is denied or missing.
import { Alert, AlertDescription, AlertTitle } from '@causedeck/ui/alert';
import { useTranslations } from 'next-intl';

export function VoiceOnboardingNote() {
  const t = useTranslations('voice');
  return (
    <section data-slot="voice-onboarding" className="flex flex-col gap-1 text-sm">
      <h2 className="text-ink font-medium">{t('onboarding.title')}</h2>
      <ul className="text-ink-muted list-disc pl-5 text-xs">
        <li>{t('onboarding.why')}</li>
        <li>{t('onboarding.india')}</li>
        <li>{t('onboarding.retention')}</li>
      </ul>
    </section>
  );
}

/** Microphone denied or unavailable: how to switch it on. */
export function VoiceDenied({ kind }: { kind: 'denied' | 'unavailable' }) {
  const t = useTranslations('voice');
  return (
    <div className="flex flex-col gap-3 p-4" data-slot="voice-denied">
      <Alert>
        <AlertTitle>{t(`${kind}.title`)}</AlertTitle>
        <AlertDescription>
          {kind === 'denied' ? t('denied.steps') : t('unavailable.body')}
        </AlertDescription>
      </Alert>
      {kind === 'denied' ? <p className="text-ink text-sm">{t('denied.body')}</p> : null}
      <p className="text-ink-muted text-xs">{t('privacy')}</p>
    </div>
  );
}
