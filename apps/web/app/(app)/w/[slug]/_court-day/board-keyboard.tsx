'use client';
// Keyboard control of the court-day board (#59): roving focus over the item cards, hall to hall
// movement, and the shortcut help. Plain-key hotkeys are ignored while typing in a field.
import { ShortcutsDialog, type Shortcut } from '@causedeck/ui/shortcuts-dialog';
import { useHotkey } from '@causedeck/ui/hooks';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { BOARD_SHORTCUTS, hallColumns, itemsIn, roveTo, step } from './keyboard.ts';

export function BoardKeyboard({ slug, children }: { slug: string; children: ReactNode }) {
  const t = useTranslations('courtDay.board.shortcuts');
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [help, setHelp] = useState(false);

  // The first item is the board's single tab stop until the member moves.
  useEffect(() => {
    const all = itemsIn(root.current ?? document, null);
    all.forEach((el, i) => {
      el.tabIndex = i === 0 ? 0 : -1;
    });
  }, []);

  const column = () =>
    (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-hall-column]') ??
    null;
  const all = () => itemsIn(root.current ?? document, null);

  const moveItem = (delta: 1 | -1) => {
    const items = all();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const target = items[step(items.length, index, delta)];
    if (target) roveTo(items, target);
  };
  const moveHall = (delta: 1 | -1) => {
    const columns = hallColumns(root.current ?? document);
    const index = columns.indexOf(column() as HTMLElement);
    const next = columns[step(columns.length, index, delta)];
    const first = next ? itemsIn(next, null)[0] : undefined;
    if (first) roveTo(all(), first);
  };
  const focusIn = (selector: string) => {
    const scope = column() ?? root.current ?? document;
    scope.querySelector<HTMLElement>(selector)?.focus();
  };

  useHotkey('j', () => {
    moveItem(1);
  });
  useHotkey('k', () => {
    moveItem(-1);
  });
  useHotkey('l', () => {
    moveHall(1);
  });
  useHotkey('h', () => {
    moveHall(-1);
  });
  useHotkey(
    'Enter',
    () => {
      const active = document.activeElement as HTMLElement | null;
      if (active?.matches('[data-court-item]')) {
        active.querySelector<HTMLElement>('a[data-matter-link]')?.click();
      }
    },
    { preventDefault: false },
  );
  useHotkey('c', () => {
    const lists = (root.current ?? document).querySelectorAll<HTMLElement>('[data-carry-list]');
    [...lists].find((el) => el.offsetParent !== null)?.focus();
  });
  useHotkey('m', () => {
    focusIn('[data-court-marker-input]');
  });
  useHotkey('o', () => {
    const active = document.activeElement as HTMLElement | null;
    active
      ?.closest('[data-court-item]')
      ?.querySelector<HTMLElement>('[data-quick-actions]')
      ?.click();
  });
  useHotkey('d', () => {
    (root.current ?? document).querySelector<HTMLElement>('[data-diff-trigger]')?.click();
  });
  useHotkey('/', () => {
    (root.current ?? document).querySelector<HTMLElement>('[data-hall-rail] a')?.focus();
  });
  useHotkey('g then t', () => {
    router.push(`/w/${slug}/today`);
  });
  useHotkey('g then m', () => {
    router.push(`/w/${slug}/matters`);
  });

  const shortcuts: Shortcut[] = BOARD_SHORTCUTS.map((s) => ({
    keys: s.keys,
    description: t(s.id),
  }));

  return (
    <div ref={root} data-court-day-board>
      {children}
      <ShortcutsDialog shortcuts={shortcuts} open={help} onOpenChange={setHelp} />
    </div>
  );
}
