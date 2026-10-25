// One listed item (#59): numeral, matter, case number, stage badge and chips. The name read by a
// screen reader follows "Item <n>, <case no.>, <stage>, brief <p> percent ready, <clash note>". No
// element predicts when the item will be called and none shows bench or judge data.
import { ItemNumeral, StageBadge, LISTING_STAGES, PROCEEDING_STAGES } from '@causedeck/ui/patterns';
import type { Stage } from '@causedeck/ui/patterns';
import type { CourtDayItem, ListDiff } from '@causedeck/validators';
import { ArrowRightLeft, Link2, Plus, Split, TriangleAlert, UserRound } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { QuickActionsSheet } from './quick-actions-sheet.tsx';
import { ReadinessRing } from './readiness-ring.tsx';

const STAGES: readonly string[] = [...PROCEEDING_STAGES, ...LISTING_STAGES];

/** The badge stage of a normalised stage; anything else shows as `listed` with its raw text. */
export function toStage(stageNorm: string | null | undefined): Stage {
  return stageNorm != null && STAGES.includes(stageNorm) ? (stageNorm as Stage) : 'listed';
}

/** The leading number of an item number (`12A` is 12); null for an unnumbered item. */
export function ordinalOf(itemNo: string | null): number | null {
  const n = itemNo === null ? Number.NaN : Number.parseInt(itemNo, 10);
  return Number.isNaN(n) ? null : n;
}

export interface ItemCardProps {
  item: CourtDayItem;
  slug: string;
  workspaceId: string;
  listDate: string;
  canWrite: boolean;
  /** Before the court-is-at marker. */
  dimmed: boolean;
  clash: boolean;
  /** List change flag from the latest diff: added, moved (with the hall it came from) or removed. */
  change: { kind: 'added' | 'moved' | 'removed'; fromHall: string | null } | null;
  /** The first item is the board's tab stop until the member moves. */
  tabStop: boolean;
  readinessPercent: number | null;
}

/** The change a diff made to an item, matched on the proceeding. */
export function changeOf(item: CourtDayItem, diffs: readonly ListDiff[]): ItemCardProps['change'] {
  for (const diff of diffs) {
    for (const kind of ['added', 'moved', 'removed'] as const) {
      const hit = diff[kind].find(
        (e) => e.proceedingKey === item.proceedingId || e.proceedingKey === item.caseLabel,
      );
      if (hit) return { kind, fromHall: hit.before?.hallNo ?? null };
    }
  }
  return null;
}

export async function ItemCard(props: ItemCardProps) {
  const { item, slug, workspaceId, listDate, canWrite, dimmed, clash, change } = props;
  const t = await getTranslations('courtDay.board');
  const stage = toStage(item.stageNorm);
  const stageLabel = STAGES.includes(item.stageNorm ?? '') ? t(`stage.${stage}`) : item.stageRaw;
  const brief =
    props.readinessPercent === null
      ? t('item.briefUnknown')
      : t('item.brief', { percent: props.readinessPercent });
  const name = [
    t('item.name', { n: item.itemNo ?? t('item.unnumbered') }),
    item.caseLabel,
    stageLabel,
    brief,
    ...(clash ? [t('item.clashNote')] : []),
  ].join(', ');
  const ChangeIcon = change?.kind === 'added' ? Plus : change?.kind === 'moved' ? ArrowRightLeft : Split;

  return (
    <QuickActionsSheet
      workspaceId={workspaceId}
      matterHref={`/w/${slug}/matters/${item.matterId}`}
      hallId={item.hallId}
      itemNo={item.itemNo}
      listDate={listDate}
      canWrite={canWrite}
      label={name}
      dimmed={dimmed}
      tabIndex={props.tabStop ? 0 : -1}
    >
      <ItemNumeral itemNo={item.itemNo} unnumberedLabel={t('item.unnumbered')} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={`/w/${slug}/matters/${item.matterId}`}
          data-matter-link
          tabIndex={-1}
          className="min-w-0 font-medium wrap-break-word hover:underline"
        >
          {item.matterTitle === '' ? t('item.restricted') : item.matterTitle}
        </Link>
        <p className="text-ink-muted text-sm">{item.caseLabel}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <StageBadge stage={stage} label={stageLabel} />
          {change === null ? null : (
            <span
              data-change={change.kind}
              className="border-border inline-flex items-center gap-1 rounded-full border px-2 text-xs"
            >
              <ChangeIcon aria-hidden="true" className="size-3" />
              {t(`change.${change.kind}`, { hall: change.fromHall ?? '—' })}
            </span>
          )}
          {clash ? (
            <span
              data-clash-marker
              className="border-border inline-flex items-center gap-1 rounded-full border px-2 text-xs"
            >
              <TriangleAlert aria-hidden="true" className="size-3" />
              {t('item.clash')}
            </span>
          ) : null}
          {item.carryCount > 0 ? (
            <span className="border-border inline-flex items-center gap-1 rounded-full border px-2 text-xs">
              <Link2 aria-hidden="true" className="size-3" />
              {t('item.carried', { count: item.carryCount })}
            </span>
          ) : null}
          {item.assigneeMemberId === null ? null : (
            <span className="border-border inline-flex items-center gap-1 rounded-full border px-2 text-xs">
              <UserRound aria-hidden="true" className="size-3" />
              {t('item.delegated')}
            </span>
          )}
        </div>
      </div>
      <ReadinessRing percent={props.readinessPercent} label={brief} />
    </QuickActionsSheet>
  );
}
