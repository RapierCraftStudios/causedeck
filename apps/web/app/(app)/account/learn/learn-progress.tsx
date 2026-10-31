// Account practice-school section (#703 R4): the signed-in user's progress through the learning
// modules, read through `@causedeck/core/activation` for the session user only (row-level
// security keys the table on that user), listed by `LearnProgressList`.
import { getTranslations } from 'next-intl/server';

import { LearnProgressList } from '../../../../components/settings/learn-progress-list.tsx';
import { SettingSection } from '../../../../components/settings/setting-section.tsx';
import { setLearnModuleDoneAction } from '../learn-progress-actions.ts';

export async function loadLearnProgress(userId: string) {
  const { db } = await import('@causedeck/core/runtime');
  const { LEARN_MODULE_SLUGS, listCompletedLearnModules } =
    await import('@causedeck/core/activation');
  const done = new Set((await listCompletedLearnModules(db, { userId })).map((e) => e.slug));
  return LEARN_MODULE_SLUGS.map((slug) => ({ slug, done: done.has(slug) }));
}

export async function LearnProgressSection({
  modules,
}: {
  modules: Awaited<ReturnType<typeof loadLearnProgress>>;
}) {
  const t = await getTranslations('settings.account.learn');
  return (
    <SettingSection id="learn-progress" title={t('title')} description={t('description')}>
      <LearnProgressList modules={modules} setDone={setLearnModuleDoneAction} />
    </SettingSection>
  );
}
