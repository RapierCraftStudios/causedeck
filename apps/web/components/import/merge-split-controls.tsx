'use client';
// Rename, merge and split without leaving the grid (#551). Keyboard: `e`, `m` and `s` on the active
// row call the same handlers (confirm-grid.tsx).
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';

export interface MergeSplitControlsProps {
  canMerge: boolean;
  canSplit: boolean;
  onRename: () => void;
  onMerge: () => void;
  onSplit: () => void;
}

export function MergeSplitControls({
  canMerge,
  canSplit,
  onRename,
  onMerge,
  onSplit,
}: MergeSplitControlsProps) {
  const t = useTranslations('bootstrapImport');
  return (
    <div data-slot="merge-split-controls" className="flex flex-wrap gap-2">
      <Button type="button" variant="ghost" size="sm" onClick={onRename}>
        {t('grid.edit')}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={!canMerge} onClick={onMerge}>
        {t('grid.mergeNext')}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={!canSplit} onClick={onSplit}>
        {t('grid.splitLast')}
      </Button>
    </div>
  );
}
