import type { ComputationView, RuleView } from '@causedeck/core/limitation';
import { useTranslations } from 'next-intl';

export interface RuleStepsProps {
  computation: ComputationView;
  /** The rule the computation used; absent for a clerk or viewer, who see due dates only. */
  rule?: RuleView | undefined;
}

/** The working behind a date: rule and version, period, start, excluded days and the result. */
export function RuleSteps({ computation, rule }: RuleStepsProps) {
  const t = useTranslations('limitation');
  return (
    <section data-slot="limitation-rule-steps" aria-label={t('steps.title')}>
      <h4 className="text-ink-muted text-xs font-medium">{t('steps.title')}</h4>
      <ol className="mt-1 flex list-decimal flex-col gap-1 ps-5 text-sm">
        {computation.ruleCode !== undefined && (
          <li>
            {t('steps.rule', {
              code: computation.ruleCode,
              version: computation.ruleVersion ?? '',
            })}
          </li>
        )}
        {rule !== undefined && (
          <li>
            {t('steps.period', {
              value: rule.periodValue,
              unit: rule.periodUnit,
              event: rule.startEvent,
            })}
          </li>
        )}
        {computation.startDate !== undefined && (
          <li>{t('steps.start', { date: computation.startDate })}</li>
        )}
        {computation.excludedDays !== undefined && computation.excludedDays > 0 && (
          <li>{t('steps.excluded', { count: computation.excludedDays })}</li>
        )}
        <li>{t('steps.expires', { date: computation.expiresOn })}</li>
        {(computation.notes ?? []).map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ol>
    </section>
  );
}
