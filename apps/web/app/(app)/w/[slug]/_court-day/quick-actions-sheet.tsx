'use client';
// An item card with its quick-action sheet (#59). The sheet opens on long-press (500 ms, touch or
// mouse) and on Enter or Space from the card's actions button; no swipe gesture is bound. The card
// body is server-rendered and arrives as children.
import { Button } from '@causedeck/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@causedeck/ui/sheet';
import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type ReactNode } from 'react';

import { setCurrentItemAction } from './actions.ts';

const LONG_PRESS_MS = 500;
/** A press that moves further than this is a drag or a scroll, not a long-press. */
const MOVE_TOLERANCE_PX = 10;

export interface QuickActionsSheetProps {
  children: ReactNode;
  workspaceId: string;
  matterHref: string;
  hallId: string | null;
  itemNo: string | null;
  listDate: string;
  canWrite: boolean;
  /** The accessible name of the item card. */
  label: string;
  dimmed: boolean;
  tabIndex: 0 | -1;
}

export function QuickActionsSheet({
  children,
  workspaceId,
  matterHref,
  hallId,
  itemNo,
  listDate,
  canWrite,
  label,
  dimmed,
  tabIndex,
}: QuickActionsSheetProps) {
  const t = useTranslations('courtDay.board.actions');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const number = itemNo === null ? Number.NaN : Number.parseInt(itemNo, 10);
  const canMark = canWrite && hallId !== null && Number.isInteger(number) && number > 0;

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <article
      data-court-item
      data-dimmed={dimmed ? '' : undefined}
      aria-label={label}
      tabIndex={tabIndex}
      className="border-border bg-surface focus-visible:ring-ring relative flex gap-3 rounded-md border p-3 focus-visible:ring-2 focus-visible:outline-none data-dimmed:opacity-60"
      onPointerDown={(event) => {
        cancel();
        origin.current = { x: event.clientX, y: event.clientY };
        timer.current = setTimeout(() => {
          setOpen(true);
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(event) => {
        const from = origin.current;
        if (
          from !== null &&
          Math.hypot(event.clientX - from.x, event.clientY - from.y) > MOVE_TOLERANCE_PX
        ) {
          cancel();
        }
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      {children}
      <Button
        type="button"
        variant="ghost"
        size="md"
        className="size-11 shrink-0"
        aria-label={t('open')}
        data-quick-actions
        onClick={() => {
          setOpen(true);
        }}
      >
        <MoreHorizontal aria-hidden="true" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
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
                      setOpen(false);
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
    </article>
  );
}
