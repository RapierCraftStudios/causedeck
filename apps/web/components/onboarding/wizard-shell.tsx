'use client';
// The wizard frame (#92, /design spec): at 360 one task per screen with a thin progress bar and the
// step's own sticky bottom button; at 768 a centred 560 px card with a left rail of steps; from
// 1280 the form on the left and a live preview on the right. One `h1` per step, focused on
// navigation. Keyboard: Enter advances (a form submits itself; elsewhere the primary button is
// pressed), Shift+Enter or the Back button goes back, `?` opens the shortcut sheet. Motion: a
// 200 ms direction-aware slide, instant under reduced motion (`motion-safe:`).
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { ShortcutsDialog } from '@causedeck/ui/shortcuts-dialog';
import { ArrowLeft, Keyboard, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useOnline } from '../settings/settings-offline-banner.tsx';

import { cn } from './cn.ts';
import { IndiaNote } from './india-note.tsx';
import { Stepper, type StepperItem } from './stepper.tsx';

export interface WizardShellProps {
  steps: readonly StepperItem[];
  /** The step's id, for `data-step` and the slide direction. */
  stepId: string;
  title: string;
  purpose: string;
  /** The quiet `Why we ask` line. */
  why: string;
  /** Where Back goes; `null` on the first step. */
  backHref: string | null;
  /** Where the step was entered from, to slide the right way. */
  direction?: 'forward' | 'back';
  /** The step's form or content. */
  children: ReactNode;
  /** The live preview, from 1280 px. */
  preview?: ReactNode;
  /** Steps that need the network show a disabled state and this note when offline. */
  needsNetwork?: boolean;
}

/** True when the keydown happened where Enter has no meaning of its own. */
function isInert(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  return target === document.body || target.tagName === 'MAIN' || target.tagName === 'H1';
}

export function WizardShell({
  steps,
  stepId,
  title,
  purpose,
  why,
  backHref,
  direction = 'forward',
  children,
  preview,
  needsNetwork = false,
}: WizardShellProps) {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const online = useOnline();
  const heading = useRef<HTMLHeadingElement>(null);
  const [help, setHelp] = useState(false);

  // Focus moves to the step heading on navigation.
  useEffect(() => {
    heading.current?.focus();
  }, [stepId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing || event.repeat) return;
      if (event.shiftKey) {
        if (backHref === null || event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        router.push(backHref);
        return;
      }
      if (isInert(event.target)) {
        const primary = document.querySelector<HTMLButtonElement>('[data-onboarding-primary]');
        if (primary && !primary.disabled) {
          event.preventDefault();
          primary.click();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [backHref, router]);

  return (
    <div
      data-route="onboarding"
      data-step={stepId}
      className="mx-auto grid w-full max-w-[1200px] gap-6 px-4 py-6 md:grid-cols-[14rem_minmax(0,35rem)] md:justify-center md:px-6 xl:grid-cols-[14rem_minmax(0,35rem)_minmax(0,1fr)] xl:px-8"
    >
      <Stepper steps={steps} className="md:pt-2" />
      <main
        id="main"
        tabIndex={-1}
        className="bg-surface border-line flex min-w-0 flex-col gap-5 rounded-lg border p-5 md:p-8"
      >
        <div
          key={stepId}
          data-direction={direction}
          className={cn(
            'flex flex-col gap-5',
            'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200',
            direction === 'forward'
              ? 'motion-safe:slide-in-from-right-4'
              : 'motion-safe:slide-in-from-left-4',
          )}
        >
          <header className="flex flex-col gap-2">
            <h1
              ref={heading}
              tabIndex={-1}
              className="font-serif text-2xl font-medium outline-none md:text-3xl"
            >
              {title}
            </h1>
            <p className="text-ink-muted text-base">{purpose}</p>
          </header>
          {stepId === 'workspace' ? <IndiaNote /> : null}
          {needsNetwork && !online ? (
            <Alert tone="warning" icon={<WifiOff />} data-pattern-state="offline">
              {t('states.offline')}
            </Alert>
          ) : null}
          <div>{children}</div>
          <p className="text-ink-muted text-sm">{why}</p>
        </div>
        <footer className="border-line flex items-center justify-between gap-2 border-t pt-3">
          {backHref === null ? (
            <span />
          ) : (
            <Button asChild variant="ghost" size="md">
              <Link href={backHref}>
                <ArrowLeft aria-hidden="true" />
                {t('nav.back')}
              </Link>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={() => {
              setHelp(true);
            }}
          >
            <Keyboard aria-hidden="true" />
            {t('nav.shortcuts')}
          </Button>
        </footer>
      </main>
      {preview ? (
        <aside
          aria-hidden="true"
          data-slot="onboarding-preview"
          className="bg-surface-raised border-line hidden min-w-0 rounded-lg border p-6 xl:block"
        >
          {preview}
        </aside>
      ) : null}
      <ShortcutsDialog
        open={help}
        onOpenChange={setHelp}
        shortcuts={[
          { keys: 'Enter', description: t('shortcuts.next') },
          { keys: 'shift+Enter', description: t('shortcuts.back') },
          { keys: '?', description: t('shortcuts.open') },
        ]}
        labels={{ title: t('shortcuts.title'), description: t('shortcuts.description') }}
      />
    </div>
  );
}
