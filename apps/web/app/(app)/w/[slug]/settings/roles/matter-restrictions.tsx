'use client';
// Restricted matters (#285): the workspace's restricted matters the viewer may read, from
// `@causedeck/core/matters` `listMatterRestrictions` (the #20 API over `matter_restriction`), each with
// the members on its allow list. Matters themselves arrive with Court Graph, so a matter shows by a
// short id and the picker that restricts one is a disabled stub until then. Empty: `No restricted
// matters`. A client component only for the locale-aware list and date formatting.
import { Button } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { Lock } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

export interface MatterRestrictionView {
  matterId: string;
  reason: string | null;
  /** ISO timestamp. */
  createdAt: string;
  allowedUsers: { userId: string; name: string }[];
}

export function MatterRestrictions({
  restrictions,
}: {
  restrictions: readonly MatterRestrictionView[];
}) {
  const t = useTranslations('settings.roles');
  const format = useFormatter();
  return (
    <section
      aria-labelledby="roles-restricted-title"
      data-slot="matter-restrictions"
      className="border-line bg-surface flex min-w-0 flex-col gap-3 rounded-xl border p-4"
    >
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="roles-restricted-title" className="text-lg font-semibold">
            {t('restricted.title')}
          </h2>
          <p className="text-ink-muted text-sm">{t('restricted.description')}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled
          title={t('restricted.pickerUnavailable')}
          aria-describedby="roles-restricted-picker-note"
          data-slot="matter-picker-stub"
        >
          {t('restricted.picker')}
        </Button>
      </header>
      <p id="roles-restricted-picker-note" className="text-ink-muted text-xs">
        {t('restricted.pickerUnavailable')}
      </p>
      {restrictions.length === 0 ? (
        <EmptyState
          data-pattern-state="empty"
          icon={<Lock aria-hidden="true" />}
          title={t('restricted.empty')}
          description={t('restricted.emptyHint')}
        />
      ) : (
        <ul className="divide-line flex flex-col divide-y" data-slot="restricted-list">
          {restrictions.map((restriction) => (
            <li
              key={restriction.matterId}
              data-matter={restriction.matterId}
              className="flex min-w-0 flex-col gap-1 py-3"
            >
              <span className="text-sm font-medium break-words">
                {t('restricted.matter', { id: restriction.matterId.slice(0, 8) })}
              </span>
              {restriction.reason ? (
                <span className="text-ink-muted text-sm break-words">{restriction.reason}</span>
              ) : null}
              <span className="text-sm break-words">
                {restriction.allowedUsers.length === 0
                  ? t('restricted.ownersOnly')
                  : t('restricted.allowed', {
                      names: format.list(
                        restriction.allowedUsers.map((u) => u.name),
                        { type: 'conjunction' },
                      ),
                    })}
              </span>
              <span className="text-ink-muted text-xs">
                {t('restricted.since', {
                  date: format.dateTime(new Date(restriction.createdAt), { dateStyle: 'medium' }),
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
