'use client';

// The install banner (#50). Android: a dismissible banner using `beforeinstallprompt`, from the
// second visit. iOS has no Web Share Target, so it gets add-to-home-screen steps and an in-app
// "Upload files" button instead. Dismissal is remembered per viewer in localStorage (guarded), and
// the banner never shows in standalone mode.
import { Alert, AlertDescription, AlertTitle } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import {
  bannerMode,
  dismissInstall,
  isDismissed,
  isIos,
  isStandalone,
  listenForInstallPrompt,
  recordVisit,
  type BeforeInstallPromptEvent,
} from '../../lib/pwa/install.ts';

export const SHARE_FILE_ACCEPT =
  'application/pdf,image/*,audio/*,text/calendar,.ics,text/plain,application/zip,.docx';

export interface InstallBannerViewProps {
  mode: 'android' | 'ios';
  onInstall: () => void;
  onDismiss: () => void;
  onFiles: (files: File[]) => void;
}

export function InstallBannerView({ mode, onInstall, onDismiss, onFiles }: InstallBannerViewProps) {
  const t = useTranslations('pwa.install');
  const input = useRef<HTMLInputElement>(null);
  return (
    <Alert tone="info" role="region" aria-label={t('title')} data-install-banner={mode}>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <AlertTitle>{t('title')}</AlertTitle>
        <AlertDescription>{mode === 'ios' ? t('ios.body') : t('body')}</AlertDescription>
        <div className="flex flex-wrap gap-2">
          {mode === 'android' ? (
            <Button size="lg" onClick={onInstall}>
              {t('install')}
            </Button>
          ) : (
            <>
              <input
                ref={input}
                type="file"
                multiple
                hidden
                accept={SHARE_FILE_ACCEPT}
                onChange={(event) => {
                  onFiles(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
              <Button
                size="lg"
                onClick={() => {
                  input.current?.click();
                }}
              >
                {t('ios.upload')}
              </Button>
            </>
          )}
          <Button variant="ghost" size="lg" onClick={onDismiss}>
            {t('dismiss')}
          </Button>
        </div>
      </div>
    </Alert>
  );
}

export interface InstallBannerProps {
  /** Whose dismissal is remembered (a shared device has several viewers). */
  viewerId: string;
  /** Where picked files go on iOS. */
  workspaceId: string;
}

export function InstallBanner({ viewerId, workspaceId }: InstallBannerProps) {
  const [mode, setMode] = useState<'android' | 'ios' | null>(null);
  const prompt = useRef<BeforeInstallPromptEvent | null>(null);
  const visits = useRef(0);

  useEffect(() => {
    visits.current = recordVisit();
    const evaluate = () => {
      setMode(
        bannerMode({
          visits: visits.current,
          standalone: isStandalone(),
          dismissed: isDismissed(viewerId),
          ios: isIos(),
          hasPrompt: prompt.current !== null,
        }),
      );
    };
    evaluate();
    return listenForInstallPrompt((event) => {
      prompt.current = event;
      evaluate();
    });
  }, [viewerId]);

  if (mode === null) return null;
  const close = () => {
    dismissInstall(viewerId);
    setMode(null);
  };
  return (
    <InstallBannerView
      mode={mode}
      onDismiss={close}
      onInstall={() => {
        const event = prompt.current;
        if (event === null) return;
        void event.prompt().then(() => event.userChoice).then(() => {
          prompt.current = null;
          setMode(null);
        });
      }}
      onFiles={(files) => {
        if (files.length === 0) return;
        void import('../../lib/pwa/outbox/sync.ts').then(({ enqueueAndSync }) =>
          enqueueAndSync(files, { workspaceId, channel: 'upload' }),
        );
        setMode(null);
      }}
    />
  );
}
