'use client';
// The quick-action sheet of an item card (#59), split from the card so its dialog code loads on
// first open instead of with the board.
import { Button } from '@causedeck/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@causedeck/ui/sheet';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { setCurrentItemAction } from './actions.ts';

export interface QuickActionsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  matterHref: string;
  workspaceId: string;
  hallId: string | null;
  listDate: string;
  canMark: boolean;
  number: number;
}

export function QuickActionsPanel({
  open,
  onOpenChange,
  label,
  matterHref,
  workspaceId,
  hallId,
  listDate,
  canMark,
  number,
}: QuickActionsPanelProps) {
  const t = useTranslations('courtDay.board.actions');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{label}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 p-4">
          <Link
            href={matterHref}
            className="border-border flex min-h-11 items-center rounded-md border px-3 text-sm"
          >
            {t('openMatter')}
          </Link>
          {canMark ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 justify-start"
              disabled={pending}
              onClick={() => {
                start(async () => {
                  const result = await setCurrentItemAction({
                    workspaceId,
                    hallId,
                    listDate,
                    currentItem: number,
                  });
                  if (result.ok) {
                    onOpenChange(false);
                    router.refresh();
                  }
                });
              }}
            >
              {t('courtIsHere', { item: number })}
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
