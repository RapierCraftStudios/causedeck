'use client';
// Keyboard control of the Brief Sheet (#61, R10). Plain keys are ignored while typing in a field
// (`useHotkey`); Cmd/Ctrl+P is the browser's own print and runs the same print path.
import { useHotkey } from '@causedeck/ui/hooks';
import type { Shortcut } from '@causedeck/ui/shortcuts-dialog';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useState } from 'react';

import { BRIEF_SHORTCUTS, neighbour } from './keyboard.ts';
import { sectionDomId, type SectionKey } from './model.ts';

const ShortcutsDialog = dynamic(
  () => import('@causedeck/ui/shortcuts-dialog').then((m) => m.ShortcutsDialog),
  { ssr: false },
);

function focusSection(id: string | null) {
  if (id === null) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.focus();
  el.scrollIntoView({ block: 'start' });
}

export function useBriefKeyboard(sections: readonly SectionKey[], print: () => void) {
  const t = useTranslations('brief.shortcuts');
  const [help, setHelp] = useState(false);
  const ids = sections.map(sectionDomId);
  const current = () => document.activeElement?.closest('section')?.id ?? null;

  useHotkey('p', print);
  useHotkey('mod+p', print);
  useHotkey('[', () => {
    focusSection(neighbour(ids, current(), -1));
  });
  useHotkey(']', () => {
    focusSection(neighbour(ids, current(), 1));
  });
  useHotkey('c', () => {
    document.querySelector<HTMLElement>('[data-carry-list]')?.focus();
  });
  useHotkey('n', () => {
    document.getElementById(sectionDomId('court_notes'))?.focus();
  });
  useHotkey('e', () => {
    document.querySelector<HTMLElement>('[data-edit-synopsis]')?.click();
  });
  for (let digit = 1; digit <= 9; digit += 1) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- a fixed loop count, the order never changes
    useHotkey(String(digit), () => {
      focusSection(ids[digit - 1] ?? null);
    });
  }

  const shortcuts: Shortcut[] = BRIEF_SHORTCUTS.map((s) => ({ keys: s.keys, description: t(s.id) }));
  const dialog = <ShortcutsDialog shortcuts={shortcuts} open={help} onOpenChange={setHelp} />;
  return { dialog };
}
