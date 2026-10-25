import { ClashBracket } from '@causedeck/ui/patterns/court-day';
import type { Clash } from '@causedeck/validators';
import { getTranslations } from 'next-intl/server';

/**
 * The factual clash statement above a hall's first item: which two items, in which halls, for the
 * same advocate on the same date. It never states which will be reached first or when.
 */
export async function ClashCard({
  clash,
  hallNos,
}: {
  clash: Clash;
  /** Hall id to hall number, for the halls of the day. */
  hallNos: ReadonlyMap<string, string>;
}) {
  const t = await getTranslations('courtDay.board');
  const [first, second] = clash.items;
  const hallOf = (hallId: string | null) => (hallId === null ? '—' : (hallNos.get(hallId) ?? '—'));
  return (
    <ClashBracket
      data-clash={clash.kind}
      title={t('clash.title')}
      statement={t(clash.kind === 'hall' ? 'clash.hall' : 'clash.complex', {
        a: first.itemNo ?? t('item.unnumbered'),
        hallA: hallOf(first.hallId),
        b: second.itemNo ?? t('item.unnumbered'),
        hallB: hallOf(second.hallId),
      })}
    />
  );
}
