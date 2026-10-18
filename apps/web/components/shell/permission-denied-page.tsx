'use client';

import { Button } from '@causedeck/ui/button';
import { PermissionDenied } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';

// A client component: the patterns entry point includes interactive (hook-using) patterns.
/** The role lacks the permission this area needs. `Request access` is a stub until #18/#20. */
export function PermissionDeniedPage() {
  const t = useTranslations('shell.permissionDenied');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <PermissionDenied message={t('message')} />
      <div className="flex justify-center">
        <Button variant="outline" disabled title={t('requestAccessSoon')}>
          {t('requestAccess')}
        </Button>
      </div>
    </div>
  );
}
