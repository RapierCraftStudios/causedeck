'use client';
// The queue row (#68): an adapter from a `QueueItem` to the `ObligationRow` pattern. It maps the
// stored names to the issue's words through the catalog (K1: `source` is the kind, `done` is
// closed), builds the provenance chip from the source line and wires Done and Reschedule.
import { ObligationRow, type ProvenanceSource } from '@causedeck/ui/patterns';
import { useLocale, useTranslations } from 'next-intl';

import type { QueueItem } from '../../../../../../lib/obligations/queue-state.ts';

import { SwipeRow } from './swipe-row.tsx';

export interface QueueRowProps {
  item: QueueItem;
  selected: boolean;
  checked: boolean;
  /** Whether the actor may act on this row (clerks: tasks, defects and copies only). */
  canAct: boolean;
  offline: boolean;
  willSync: boolean;
  now: Date;
  onDone: () => void;
  onReschedule: () => void;
  onOpen: () => void;
  onToggle: () => void;
}

const SOURCE_KIND: Record<string, ProvenanceSource['kind']> = {
  manual: 'manual',
  document: 'document',
  capture: 'capture',
  adapter: 'adapter',
  ai: 'ai',
  import: 'import',
  system: 'system',
};

export function QueueRow({
  item,
  selected,
  checked,
  canAct,
  offline,
  willSync,
  now,
  onDone,
  onReschedule,
  onOpen,
  onToggle,
}: QueueRowProps) {
  const t = useTranslations('obligations');
  const locale = useLocale();
  const source: ProvenanceSource = {
    kind: SOURCE_KIND[item.sourceType] ?? 'manual',
    label: t(`sourceType.${item.sourceType as 'manual'}`),
    state: 'confirmed',
    ...(item.sourceQuote === null ? {} : { quote: item.sourceQuote }),
  };
  return (
    <SwipeRow
      disabled={!canAct || offline}
      onAction={(a) => {
        if (a === 'done') onDone();
        else onReschedule();
      }}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          aria-label={t('row.select', { title: item.description })}
          checked={checked}
          onChange={onToggle}
          className="mt-3 size-4"
        />
        <ObligationRow
          className="flex-1"
          title={item.description}
          matter={item.matterTitle}
          {...(item.caseNumber === null ? {} : { caseNumber: item.caseNumber })}
          due={item.dueDate ?? ''}
          now={now}
          locale={locale}
          owner={{ name: item.ownerName ?? t('row.unowned') }}
          source={source}
          kind={item.source}
          kindLabel={t(`kind.${item.source}`)}
          statusLabel={willSync ? t('willSync') : t(`status.${item.status as 'open'}`)}
          selected={selected}
          offline={offline}
          viewOnly={!canAct}
          onDone={onDone}
          onReschedule={onReschedule}
          onClick={onOpen}
          labels={{
            done: t('row.done'),
            reschedule: t('row.reschedule'),
            markDone: t('row.markDone'),
            more: (title) => t('row.more', { title }),
            swipeHint: t('row.swipeHint'),
            viewOnly: t('row.viewOnly'),
            offline: t('offline'),
            due: (state, days) =>
              item.dueDate === null
                ? t('row.undated')
                : state === 'overdue'
                  ? t('row.overdueDays', { days: Math.abs(days) })
                  : state === 'due-today'
                    ? t('row.dueToday')
                    : state === 'done'
                      ? t('status.done')
                      : days === 1
                        ? t('row.dueTomorrow')
                        : t('row.dueInDays', { days }),
          }}
        />
      </div>
    </SwipeRow>
  );
}
