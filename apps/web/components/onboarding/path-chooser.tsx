// `/onboarding` (#92): the path chooser, Solo or Chamber, with a resume card when a set-up is in
// progress. A synchronous component (`useTranslations`) so it renders in stories; the page loads the
// resume state and passes it in.
import { Button } from '@causedeck/ui/button';
import { ArrowRight, Scale, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { IndiaNote } from './india-note.tsx';

export interface ResumeCard {
  href: string;
  workspace: string;
  /** 1-based position of the step to resume at. */
  step: number;
  total: number;
}

export function PathChooser({ resume }: { resume: ResumeCard | null }) {
  const t = useTranslations('onboarding.chooser');
  return (
    <main
      id="main"
      tabIndex={-1}
      data-route="onboarding"
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 md:px-6"
    >
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-base">{t('description')}</p>
      </header>
      {resume ? (
        <section
          aria-labelledby="resume-title"
          data-slot="resume-card"
          className="bg-surface-raised border-line flex flex-col gap-3 rounded-lg border p-5"
        >
          <h2 id="resume-title" className="text-lg font-medium">
            {t('resume.title')}
          </h2>
          <p className="text-ink-muted text-sm">
            {t('resume.body', {
              step: resume.step,
              total: resume.total,
              workspace: resume.workspace,
            })}
          </p>
          <Button asChild size="lg" className="w-full sm:w-auto sm:self-start">
            <Link href={resume.href}>{t('resume.cta')}</Link>
          </Button>
        </section>
      ) : null}
      <ul className="grid gap-4 md:grid-cols-2">
        {(
          [
            { path: 'solo', Icon: Scale },
            { path: 'chamber', Icon: Users },
          ] as const
        ).map(({ path, Icon }) => (
          <li
            key={path}
            data-path={path}
            className="bg-surface border-line flex flex-col gap-3 rounded-lg border p-5"
          >
            <Icon aria-hidden="true" className="text-accent size-6" />
            <h2 className="font-serif text-xl font-medium">{t(`${path}.title`)}</h2>
            <p className="text-ink-muted flex-1 text-sm">{t(`${path}.body`)}</p>
            <Button asChild size="lg" variant={resume ? 'outline' : 'primary'}>
              <Link href={`/onboarding/${path}/workspace`}>
                {t(`${path}.cta`)}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </li>
        ))}
      </ul>
      <IndiaNote />
    </main>
  );
}
