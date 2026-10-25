import { ClashBracket } from '@causedeck/ui/patterns';
import type { Clash } from '@causedeck/validators';
import { getTranslations } from 'next-intl/server';

/** The factual clash statement above a hall's first item. It never states a predicted time. */
export async function ClashCard({ clash }: { clash: Clash }) {
  const t = await getTranslations('courtDay.board.clash');
  return (
    <ClashBracket
      data-clash={clash.kind}
      title={t('title')}
      statement={t(clash.kind === 'hall' ? 'hall' : 'complex')}
    />
  );
}
