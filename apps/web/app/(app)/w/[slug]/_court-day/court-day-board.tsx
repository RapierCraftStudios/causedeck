// The court-day board (#59), shared by `/today` and `/tomorrow`: complex -> hall -> item, one hall
// at a time on a phone (`?hall=`), columns with snap on a wide screen, the rail on the side.
import { EmptyState } from '@causedeck/ui/empty-state';
import type { CourtDay, ListDiff } from '@causedeck/validators';
import { getTranslations } from 'next-intl/server';

import { AttentionStrip } from './attention-strip.tsx';
import { BoardKeyboard } from './board-keyboard.tsx';
import { BoardStatus } from './board-status.tsx';
import { DayHeader } from './day-header.tsx';
import { DayRail } from './day-rail.tsx';
import { DayRibbon } from './day-ribbon.tsx';
import { HallColumn } from './hall-column.tsx';
import { HallRail } from './hall-rail.tsx';
import type { BoardData } from './load-court-day.ts';

export interface CourtDayBoardProps {
  slug: string;
  workspaceId: string;
  which: 'today' | 'tomorrow';
  locale: string;
  canWrite: boolean;
  board: BoardData;
  /** The `bench_facts` flag is on for the workspace: halls may show their bench (D-050). */
  showBench: boolean;
  /** The `?hall=` value: a hall id, or a hall number for a hall without an id. */
  selectedHall: string | undefined;
}

const hallKey = (hall: { hallId: string | null; hallNo: string | null }) =>
  hall.hallId ?? hall.hallNo ?? '';

export async function CourtDayBoard(props: CourtDayBoardProps) {
  const { slug, which, board } = props;
  const day: CourtDay = board.day;
  const t = await getTranslations('courtDay.board');
  const halls = day.complexes.flatMap((complex) =>
    complex.halls.map((hall) => ({ complex, hall, key: hallKey(hall) })),
  );
  const itemCount = halls.reduce(
    (n, { hall }) => n + hall.lists.reduce((m, list) => m + list.items.length, 0),
    0,
  );
  const selected = halls.some((h) => h.key === props.selectedHall)
    ? (props.selectedHall ?? '')
    : (halls[0]?.key ?? '');
  const diffs: readonly ListDiff[] = board.diffs;
  const changes = diffs.reduce((n, d) => n + d.added.length + d.removed.length + d.moved.length, 0);
  const hallNos = new Map(
    halls.flatMap(({ hall }) =>
      hall.hallId === null || hall.hallNo === null ? [] : [[hall.hallId, hall.hallNo] as const],
    ),
  );
  const firstItem = halls[0]?.hall.lists.flatMap((l) => l.items)[0]?.listingId ?? null;

  return (
    <BoardKeyboard slug={slug}>
      <div data-route={which} className="flex flex-col gap-3">
        <DayHeader
          which={which}
          date={day.date}
          items={itemCount}
          halls={halls.length}
          freshness={day.freshness}
          locale={props.locale}
        />
        <DayRibbon slug={slug} which={which} />
        <BoardStatus changes={changes} readAt={day.freshness} />
        <AttentionStrip
          slug={slug}
          which={which}
          failures={board.failures}
          diffs={diffs}
          expected={day.expectedNotListed}
          locale={props.locale}
        />
        {itemCount === 0 ? (
          <EmptyState
            data-pattern-state="empty"
            title={t('empty.title')}
            description={t('empty.description')}
          />
        ) : (
          <>
            <HallRail
              label={t('hallRail.label')}
              selected={selected}
              halls={halls.map(({ hall, key }) => ({
                key,
                label:
                  hall.hallNo === null
                    ? t('hall.unassigned')
                    : t('hall.name', { hallNo: hall.hallNo }),
                count: hall.lists.reduce((m, l) => m + l.items.length, 0),
              }))}
              hrefFor={(key) => `/w/${slug}/${which}?hall=${encodeURIComponent(key)}`}
            />
            <div className="flex flex-col gap-4 xl:flex-row">
              <div className="grid min-w-0 flex-1 gap-4 md:grid-cols-2 xl:flex xl:snap-x xl:overflow-x-auto">
                {halls.map(({ complex, hall, key }) => (
                  <HallColumn
                    key={key}
                    hall={hall}
                    forum={complex.name}
                    slug={slug}
                    workspaceId={props.workspaceId}
                    listDate={day.date}
                    canWrite={props.canWrite}
                    clashes={board.clashes}
                    hallNos={hallNos}
                    diffs={diffs}
                    selected={key === selected}
                    tabStopListingId={firstItem}
                    showBench={props.showBench}
                  />
                ))}
              </div>
              <DayRail day={day} slug={slug} />
            </div>
          </>
        )}
      </div>
    </BoardKeyboard>
  );
}
