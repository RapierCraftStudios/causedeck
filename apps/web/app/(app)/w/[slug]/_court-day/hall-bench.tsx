// The bench line of a hall header (#59, D-050). "Who sat" is a bench fact: it shows only where the
// `bench_facts` flag is on for the workspace (legal sign-off, #118), and the page resolves that.
// It is its own line, apart from the item count, and carries no figure about any bench.
import { getTranslations } from 'next-intl/server';

export async function HallBench({ names }: { names: readonly string[] }) {
  if (names.length === 0) return null;
  const t = await getTranslations('courtDay.board');
  return (
    <span data-hall-bench className="block [font-variant-caps:all-small-caps]">
      {t('hall.bench', { judges: names.join(', ') })}
    </span>
  );
}
