'use client';
// 'Include private notes when printing' (#61, R7): off by default, remembered per member through
// `setPrintNotesAction`. The sheet hides the court notes in print unless it is on.
import { Switch } from '@causedeck/ui/switch';
import { useTranslations } from 'next-intl';
import { useId, useTransition } from 'react';

import { setPrintNotesAction } from '../actions.ts';

export function PrintToggle({
  workspaceId,
  checked,
  onChange,
}: {
  workspaceId: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const t = useTranslations('brief.courtNotes');
  const [, start] = useTransition();
  const id = useId();
  return (
    <div className="flex items-center gap-2 font-sans text-sm print:hidden">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={(next) => {
          onChange(next);
          start(async () => {
            const result = await setPrintNotesAction({ workspaceId, include: next });
            if (!result.ok) onChange(!next);
          });
        }}
      />
      <label htmlFor={id}>{t('printToggle')}</label>
    </div>
  );
}
