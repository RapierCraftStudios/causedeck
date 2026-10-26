'use client';
// The list-diff trigger (#59), opened from the attention strip. The sheet itself (Radix dialog and
// the icons) loads on first open, not with the board.
import { Button } from '@causedeck/ui/button';
import type { ListDiff } from '@causedeck/validators';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useState } from 'react';

const ListDiffPanel = dynamic(() => import('./list-diff-panel.tsx').then((m) => m.ListDiffPanel), {
  ssr: false,
});

export function ListDiffSheet({ diffs }: { diffs: readonly ListDiff[] }) {
  const t = useTranslations('courtDay.board.diff');
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const total = diffs.reduce((n, d) => n + d.added.length + d.removed.length + d.moved.length, 0);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11"
        data-diff-trigger
        onClick={() => {
          setOpened(true);
          setOpen(true);
        }}
      >
        {t('open', { count: total })}
      </Button>
      {opened ? <ListDiffPanel diffs={diffs} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
