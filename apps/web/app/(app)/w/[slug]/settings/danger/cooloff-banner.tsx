// The cool-off banner (#305, #31 design spec): while a workspace deletion waits out its 14 days,
// every member sees `Scheduled for deletion on <date>. Cancel any time before then.` under the
// shell topbar on every workspace page. Owners also get `Cancel deletion`, a link to the danger
// zone, where the cancel runs after a fresh step-up. Not dismissible. No client JS: the workspace
// layout loads the deletion on the server (`activeWorkspaceDeletionIn`).
import { Alert } from '@causedeck/ui/alert';
import { CalendarClock } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';

import { settingsHref } from '../../../../../../lib/settings-nav.ts';

/** The active deletion the shell shows; dates as ISO strings. */
export interface ShellDeletion {
  jobId: string;
  cooloffUntil: string;
}

export interface CooloffBannerProps {
  deletion: ShellDeletion | null;
  slug: string;
  owner: boolean;
}

export function CooloffBanner({ deletion, slug, owner }: CooloffBannerProps) {
  const t = useTranslations('lifecycle.danger');
  const format = useFormatter();
  if (deletion === null) return null;
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-4 md:px-6">
      <Alert
        tone="danger"
        icon={<CalendarClock />}
        data-slot="cooloff-banner"
        className="break-words"
        action={
          owner ? (
            <Link
              href={settingsHref(slug, 'danger')}
              className="text-accent text-sm font-medium underline-offset-2 hover:underline"
            >
              {t('cancel')}
            </Link>
          ) : undefined
        }
      >
        {t('scheduled', {
          date: format.dateTime(new Date(deletion.cooloffUntil), { dateStyle: 'medium' }),
        })}
      </Alert>
    </div>
  );
}
