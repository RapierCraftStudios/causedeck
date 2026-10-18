'use client';

// The `?` help dialog. Only ever loaded with `import()` (provider.tsx), on first open, so the Radix
// dialog stays out of the initial route JS (#11: the shell adds at most 40 KB gzip).
import { ShortcutsDialog, type Shortcut } from '@causedeck/ui/shortcuts-dialog';
import { useTranslations } from 'next-intl';

import { SHORTCUT_GROUPS, type ShortcutDefinition } from './registry.ts';

export interface ShortcutsHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: readonly ShortcutDefinition[];
}

/** Every shortcut the user can use, grouped by area (Navigation, Actions, Help). */
export function ShortcutsHelpDialog({ open, onOpenChange, shortcuts }: ShortcutsHelpDialogProps) {
  const t = useTranslations();
  const rows: Shortcut[] = SHORTCUT_GROUPS.flatMap((group) =>
    shortcuts
      .filter((shortcut) => shortcut.group === group)
      .map((shortcut) => ({
        keys: shortcut.keys,
        description:
          shortcut.navId === undefined
            ? t(shortcut.labelKey)
            : t('shortcuts.goTo', { destination: t(shortcut.labelKey) }),
        group: t(`shortcuts.groups.${group}`),
      })),
  );
  return (
    <ShortcutsDialog
      shortcuts={rows}
      open={open}
      onOpenChange={onOpenChange}
      enableHotkey={false}
      labels={{
        title: t('shortcuts.title'),
        description: t('shortcuts.description'),
        close: t('shortcuts.close'),
        then: t('shortcuts.then'),
      }}
    />
  );
}
