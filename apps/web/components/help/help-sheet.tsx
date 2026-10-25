'use client';

// The help sheet (#94): a modal (Radix dialog: focus trap, Escape, focus restored to the opener)
// with Articles, Shortcuts and Contact tabs. A bottom sheet on a phone, a side drawer elsewhere.
// Opened from a contextual `?` tip it starts on that surface's article, without leaving the page.
// On touch devices the shortcut table is replaced by a gestures guide.
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@causedeck/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@causedeck/ui/tabs';
import { useMediaQuery } from '@causedeck/ui/hooks';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  SHORTCUT_GROUPS,
  visibleShortcuts,
  type ShortcutDefinition,
} from '../../lib/shortcuts/registry.ts';
import type { Role } from '../../lib/workspace-context.ts';

import { HelpArticles } from './help-articles.tsx';
import { SupportContact } from './support-contact.tsx';

export type HelpTab = 'articles' | 'shortcuts' | 'contact';

export interface HelpSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  role?: Role | undefined;
  /** The article to open first (a contextual tip). */
  articleSlug?: string | undefined;
  initialTab?: HelpTab | undefined;
  /** Defaults to the registry, narrowed to what `role` can open. */
  shortcuts?: readonly ShortcutDefinition[] | undefined;
}

/** The shortcut sheet as a labelled table, grouped by area, from the central registry. */
export function ShortcutTable({ shortcuts }: { shortcuts: readonly ShortcutDefinition[] }) {
  const t = useTranslations();
  const label = (key: string) => t(key as Parameters<typeof t>[0]);
  return (
    <table className="w-full text-sm" aria-label={t('help.shortcuts.table')}>
      <thead>
        <tr className="text-start">
          <th scope="col" className="py-1 text-start">
            {t('help.shortcuts.area')}
          </th>
          <th scope="col" className="py-1 text-start">
            {t('help.shortcuts.action')}
          </th>
          <th scope="col" className="py-1 text-start">
            {t('help.shortcuts.keys')}
          </th>
        </tr>
      </thead>
      <tbody>
        {SHORTCUT_GROUPS.flatMap((group) =>
          shortcuts
            .filter((shortcut) => shortcut.group === group)
            .map((shortcut) => (
              <tr key={shortcut.id} className="border-line border-t">
                <th scope="row" className="py-1 text-start font-normal">
                  {t(`shortcuts.groups.${group}`)}
                </th>
                <td className="py-1">
                  {shortcut.navId === undefined
                    ? label(shortcut.labelKey)
                    : t('shortcuts.goTo', { destination: label(shortcut.labelKey) })}
                </td>
                <td className="py-1">
                  <kbd className="font-mono text-xs">{shortcut.keys}</kbd>
                </td>
              </tr>
            )),
        )}
      </tbody>
    </table>
  );
}

export function GesturesGuide() {
  const t = useTranslations('help.shortcuts.gestures');
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-sans text-base font-semibold">{t('title')}</h3>
      <p className="text-muted-foreground text-sm">{t('description')}</p>
      <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
        {(['tap', 'swipe', 'hold', 'pull'] as const).map((id) => (
          <li key={id}>{t(id)}</li>
        ))}
      </ul>
    </section>
  );
}

export function HelpSheet({
  open,
  onOpenChange,
  workspaceId,
  role,
  articleSlug,
  initialTab = 'articles',
  shortcuts,
}: HelpSheetProps) {
  const t = useTranslations('help');
  const wide = useMediaQuery('(min-width: 640px)');
  const touch = useMediaQuery('(pointer: coarse)');
  const [selected, setSelected] = useState<string | undefined>(articleSlug);
  const rows = shortcuts ?? visibleShortcuts({ role });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={wide ? 'end' : 'bottom'}
        className="flex max-h-[85dvh] flex-col gap-3 sm:max-h-none sm:w-[420px] lg:w-[480px]"
      >
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <Tabs defaultValue={initialTab} className="flex min-h-0 flex-1 flex-col gap-3">
          <TabsList aria-label={t('tabs.label')}>
            <TabsTrigger value="articles">{t('tabs.articles')}</TabsTrigger>
            <TabsTrigger value="shortcuts">{t('tabs.shortcuts')}</TabsTrigger>
            <TabsTrigger value="contact">{t('tabs.contact')}</TabsTrigger>
          </TabsList>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TabsContent value="articles">
              <HelpArticles selected={selected} onSelect={setSelected} />
            </TabsContent>
            <TabsContent value="shortcuts">
              {touch ? <GesturesGuide /> : <ShortcutTable shortcuts={rows} />}
            </TabsContent>
            <TabsContent value="contact">
              <SupportContact workspaceId={workspaceId} isOwner={role === 'owner'} />
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
