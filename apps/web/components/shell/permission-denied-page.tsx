'use client';

import { PermissionDenied } from '@causedeck/ui/patterns/states';
import { useTranslations } from 'next-intl';

// A client component: the patterns entry point includes interactive (hook-using) patterns.
/** The role lacks the permission this area needs. It says whom to ask (a workspace owner changes roles) instead of offering a button with no flow. */
export function PermissionDeniedPage() {
  const t = useTranslations('shell.permissionDenied');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <PermissionDenied message={t('message')} />
      <p className="text-ink-muted text-center text-sm">{t('askOwner')}</p>
    </div>
  );
}
