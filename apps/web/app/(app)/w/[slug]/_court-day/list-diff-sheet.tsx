'use client';
// The list-diff sheet (#59): what was added, moved or removed since the last list, opened from the
// attention strip. Each line is text plus an icon, never colour alone.
import { Button } from '@causedeck/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@causedeck/ui/sheet';
import type { ListDiff } from '@causedeck/validators';
import { ArrowRightLeft, Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

const KIND_ICON = { added: Plus, removed: Minus, moved: ArrowRightLeft } as const;

export function ListDiffSheet({ diffs }: { diffs: readonly ListDiff[] }) {
  const t = useTranslations('courtDay.board.diff');
  const total = diffs.reduce((n, d) => n + d.added.length + d.removed.length + d.moved.length, 0);
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-h-11" data-diff-trigger>
          {t('open', { count: total })}
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          {diffs.map((diff, index) => (
            <section key={index} className="flex flex-col gap-2">
              <h3 className="font-serif text-base">{t(`label.${diff.label}`)}</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {(['added', 'moved', 'removed'] as const).flatMap((kind) =>
                  diff[kind].map((entry, i) => {
                    const Icon = KIND_ICON[kind];
                    return (
                      <li key={`${kind}-${String(i)}`} className="flex items-center gap-2">
                        <Icon aria-hidden="true" className="size-4 shrink-0" />
                        <span>
                          {t(`kind.${kind}`, {
                            item: (entry.after ?? entry.before)?.itemNo ?? '—',
                            hall: entry.before?.hallNo ?? '—',
                            case: entry.proceedingKey,
                          })}
                        </span>
                      </li>
                    );
                  }),
                )}
              </ul>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
