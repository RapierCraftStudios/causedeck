'use client';
// The roles step (#92): an explainer that the clerk starts restricted and cannot see strategy notes
// or matter memory, with the matrix of what each role can see. The matrix mirrors the policy
// (`MATRIX` in `@causedeck/auth/policy`): strategy notes (`strategy.read`) and memory (`memory.read`)
// are advocate-level; the clerk has the court day and the papers to carry only. It changes nothing:
// roles are set per invitation and later in Settings > Members.
import { Alert } from '@causedeck/ui/alert';
import { Check, Minus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { StepActions } from './step-actions.tsx';
import type { StepScope } from './steps.ts';
import { useStepSubmit } from './use-step-submit.ts';

type Access = 'can' | 'cannot' | 'limited';
const ROWS = [
  { role: 'owner', board: 'can', briefs: 'can', strategy: 'can', memory: 'can' },
  { role: 'advocate', board: 'can', briefs: 'can', strategy: 'can', memory: 'can' },
  { role: 'junior', board: 'can', briefs: 'can', strategy: 'cannot', memory: 'limited' },
  { role: 'clerk', board: 'can', briefs: 'limited', strategy: 'cannot', memory: 'cannot' },
] as const satisfies readonly {
  role: 'owner' | 'advocate' | 'junior' | 'clerk';
  board: Access;
  briefs: Access;
  strategy: Access;
  memory: Access;
}[];
const COLUMNS = ['board', 'briefs', 'strategy', 'memory'] as const;

/** The role-by-surface matrix, as a table (also the chamber live preview). */
export function RoleMatrix() {
  const t = useTranslations('onboarding.roles');
  const icon = (access: Access) =>
    access === 'can' ? (
      <Check aria-hidden="true" className="text-success size-4" />
    ) : access === 'limited' ? (
      <Minus aria-hidden="true" className="text-warning size-4" />
    ) : (
      <X aria-hidden="true" className="text-ink-muted size-4" />
    );
  const label = (access: Access) =>
    access === 'can' ? t('can') : access === 'limited' ? t('limited') : t('cannot');
  return (
    <table className="w-full text-sm" data-slot="role-matrix">
      <caption className="sr-only">{t('matrixLabel')}</caption>
      <thead>
        <tr className="text-ink-muted text-left">
          <th scope="col" className="py-2 pr-2 font-medium">
            {t('columns.role')}
          </th>
          {COLUMNS.map((column) => (
            <th key={column} scope="col" className="px-1 py-2 font-medium">
              {t(`columns.${column}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => (
          <tr key={row.role} data-role={row.role} className="border-line border-t">
            <th scope="row" className="py-2 pr-2 text-left font-medium">
              {t(row.role)}
            </th>
            {COLUMNS.map((column) => (
              <td key={column} className="px-1 py-2">
                <span className="inline-flex items-center gap-1">
                  {icon(row[column])}
                  <span className="sr-only">{label(row[column])}</span>
                </span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RoleExplainer({ scope }: { scope: StepScope }) {
  const t = useTranslations('onboarding.roles');
  const nav = useTranslations('onboarding.nav');
  const { submit, pending, failure } = useStepSubmit(scope);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit('roles');
      }}
      className="flex flex-col gap-5"
    >
      <Alert tone="info">
        <p className="font-medium">{t('explainerTitle')}</p>
        <p>{t('explainer')}</p>
      </Alert>
      <RoleMatrix />
      <p className="text-ink-muted text-sm">{t('change')}</p>
      {failure ? <Alert tone="danger">{t('change')}</Alert> : null}
      <StepActions label={nav('next')} pending={pending} />
    </form>
  );
}
