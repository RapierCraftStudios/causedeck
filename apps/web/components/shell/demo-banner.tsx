// Demo banner (#182, #93): every page of a demo workspace (the two sample workspaces seeded by
// `pnpm db:seed:demo`) says so above the content, so nobody mistakes the seeded matters for real
// ones. The slugs are reserved (`@causedeck/validators/workspace`), so no real workspace shows it.
// Not dismissible and no client JS: `Leave demo` (a text button, all widths) and `Start your own
// workspace` (a primary button from 768 px) post to `/demo/leave`, which ends the demo session.
// Uses the `info` role colours, never the danger colours. Slides in over 200 ms; reduced motion
// shows it at once.
import { Alert } from '@causedeck/ui/alert';
import { buttonVariants } from '@causedeck/ui/button';
import { isDemoWorkspaceSlug } from '@causedeck/validators/workspace';
import { FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function DemoBanner({ slug }: { slug: string }) {
  const t = useTranslations('shell.demoBanner');
  if (!isDemoWorkspaceSlug(slug)) return null;
  return (
    <div className="motion-safe:animate-rise mx-auto w-full max-w-[1200px] px-4 pt-4 motion-safe:[--motion-transform:translateY(-8px)] md:px-6">
      <Alert
        tone="info"
        icon={<FlaskConical />}
        data-slot="demo-banner"
        data-demo-banner=""
        className="break-words"
        action={
          <form action="/demo/leave" method="post" className="flex shrink-0 items-center gap-3">
            <button
              type="submit"
              name="to"
              value="leave"
              className={buttonVariants({ variant: 'link', size: 'sm' })}
            >
              {t('leave')}
            </button>
            <button
              type="submit"
              name="to"
              value="start"
              className={`${buttonVariants({ variant: 'primary', size: 'sm' })} hidden md:inline-flex`}
            >
              {t('start')}
            </button>
          </form>
        }
      >
        <span className="font-medium">{t('label')}</span> {t('hint')}
      </Alert>
    </div>
  );
}
