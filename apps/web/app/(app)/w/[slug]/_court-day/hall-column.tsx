// One hall of the board (#59): sticky header with the court-is-at control, the clash card above the
// first item, the items in numeric order with the marker rule, and the carry-over footer.
import { HallHeader } from '@causedeck/ui/patterns/court-day';
import type { Clash, CourtDayHall, ListDiff } from '@causedeck/validators';
import { getTranslations } from 'next-intl/server';

import { ClashCard } from './clash-card.tsx';
import { CourtIsAtMarker } from './court-is-at-marker.tsx';
import { HallBench } from './hall-bench.tsx';
import { changeOf, ItemCard, ordinalOf } from './item-card.tsx';

export interface HallColumnProps {
  hall: CourtDayHall;
  forum: string;
  slug: string;
  workspaceId: string;
  listDate: string;
  canWrite: boolean;
  clashes: readonly Clash[];
  /** Hall id to hall number across the day, for the clash statement. */
  hallNos: ReadonlyMap<string, string>;
  diffs: readonly ListDiff[];
  /** Shown on a phone; hidden there when another hall is selected. */
  selected: boolean;
  tabStopListingId: string | null;
  /** The `bench_facts` flag is on: the bench line may show (D-050). */
  showBench: boolean;
}

/** The distinct benches the hall's listings are before, as the cause list published them. */
function benchOf(items: readonly { bench: readonly string[] }[]): string[] {
  return [...new Set(items.flatMap((item) => item.bench))];
}

export async function HallColumn(props: HallColumnProps) {
  const { hall, clashes, diffs } = props;
  const t = await getTranslations('courtDay.board');
  const items = hall.lists.flatMap((list) => list.items);
  const clashIds = new Set(clashes.flatMap((c) => c.items.map((i) => i.listingId)));
  const own = clashes.filter((c) =>
    c.items.some((i) => items.some((x) => x.listingId === i.listingId)),
  );
  const marker = hall.marker?.currentItem ?? null;
  const title =
    hall.hallNo === null ? t('hall.unassigned') : t('hall.name', { hallNo: hall.hallNo });
  const firstAtMarker =
    marker === null
      ? -1
      : items.findIndex((item) => {
          const n = ordinalOf(item.itemNo);
          return n !== null && n >= marker;
        });

  return (
    <section
      data-hall-column
      data-hall={hall.hallNo ?? ''}
      aria-label={title}
      className={`min-w-0 flex-col md:flex xl:w-96 xl:shrink-0 xl:snap-start ${props.selected ? 'flex' : 'hidden'}`}
    >
      <HallHeader
        sticky
        title={title}
        detail={
          <>
            {props.forum} · {t('hall.count', { count: items.length })}
            {marker === null ? '' : ` · ${t('hall.courtIsAt', { item: marker })}`}
            {props.showBench ? <HallBench names={benchOf(items)} /> : null}
          </>
        }
        actions={
          props.canWrite && hall.hallId !== null ? (
            <CourtIsAtMarker
              workspaceId={props.workspaceId}
              hallId={hall.hallId}
              listDate={props.listDate}
              current={marker}
            />
          ) : undefined
        }
      />
      <div className="flex flex-col gap-2 p-2">
        {own.map((clash) => (
          <ClashCard
            key={`${clash.items[0].listingId}-${clash.items[1].listingId}`}
            clash={clash}
            hallNos={props.hallNos}
          />
        ))}
        {items.map((item, index) => {
          const n = ordinalOf(item.itemNo);
          return (
            <div key={item.listingId} className="flex flex-col gap-2">
              {index === firstAtMarker ? (
                <div
                  role="separator"
                  data-court-is-at-rule
                  className="border-primary text-primary flex items-center gap-2 border-t-2 pt-1 text-xs font-medium"
                >
                  {t('hall.courtIsAt', { item: marker ?? 0 })}
                </div>
              ) : null}
              <ItemCard
                item={item}
                slug={props.slug}
                workspaceId={props.workspaceId}
                listDate={props.listDate}
                canWrite={props.canWrite}
                dimmed={marker !== null && n !== null && n < marker}
                clash={clashIds.has(item.listingId)}
                change={changeOf(item, diffs)}
                tabStop={item.listingId === props.tabStopListingId}
                readinessPercent={null}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
