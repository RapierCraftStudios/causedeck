// The permission matrix (#285): which role may take each action, rendered from the policy in
// `@causedeck/auth` (`ACTIONS`, `ROLES`, `MATRIX`, `atLeast`), never from a copy of its rules. One
// table, a row group per domain, a column per role. It scrolls inside its own container on narrow
// screens (the role column stays put), so the page never scrolls sideways at 360 px. The clerk
// limits callout is derived from the matrix too: it shows while clerks lack `strategy.read` and
// `memory.read`.
import { ACTIONS, atLeast, MATRIX, ROLES, type ActionDomain } from '@causedeck/auth/policy';
import { Alert } from '@causedeck/ui/alert';
import { Check, Minus, ShieldAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/** True while the matrix keeps strategy notes and matter memory from clerks. */
export function clerksLimited(): boolean {
  return !atLeast('clerk', MATRIX['strategy.read']) && !atLeast('clerk', MATRIX['memory.read']);
}

export async function PermissionMatrix() {
  const [t, tm] = await Promise.all([
    getTranslations('settings.roles'),
    getTranslations('members'),
  ]);
  const domains = Object.keys(ACTIONS) as ActionDomain[];
  return (
    <section
      aria-labelledby="roles-matrix-title"
      data-slot="permission-matrix"
      className="border-line bg-surface flex min-w-0 flex-col gap-3 rounded-xl border p-4"
    >
      <header className="flex flex-col gap-1">
        <h2 id="roles-matrix-title" className="text-lg font-semibold">
          {t('matrix.title')}
        </h2>
        <p className="text-ink-muted text-sm">{t('matrix.description')}</p>
      </header>
      {clerksLimited() ? (
        <Alert tone="info" icon={<ShieldAlert />} data-slot="clerk-limits">
          {t('clerkLimits')}
        </Alert>
      ) : null}
      <div
        role="region"
        tabIndex={0}
        aria-label={t('matrix.caption')}
        className="-mx-4 overflow-x-auto px-4"
      >
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <caption className="sr-only">{t('matrix.caption')}</caption>
          <thead>
            <tr className="border-line border-b">
              <th scope="col" className="bg-surface sticky left-0 py-2 pr-3 text-left font-medium">
                {t('matrix.action')}
              </th>
              {ROLES.map((role) => (
                <th key={role} scope="col" className="px-2 py-2 text-center font-medium">
                  {tm(`roles.${role}`)}
                </th>
              ))}
            </tr>
          </thead>
          {domains.map((domain) => (
            <tbody key={domain} data-domain={domain}>
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={ROLES.length + 1}
                  className="text-ink-muted bg-surface sticky left-0 pt-4 pb-1 text-left text-xs font-semibold tracking-wide uppercase"
                >
                  {t(`domains.${domain}`)}
                </th>
              </tr>
              {ACTIONS[domain].map((action) => (
                <tr key={action} data-action={action} className="border-line border-b">
                  <th
                    scope="row"
                    className="bg-surface sticky left-0 py-2 pr-3 text-left font-normal"
                  >
                    {t(`actions.${action}`)}
                  </th>
                  {ROLES.map((role) => {
                    const allowed = atLeast(role, MATRIX[action]);
                    return (
                      <td
                        key={role}
                        data-role={role}
                        data-allowed={allowed ? 'true' : 'false'}
                        className="px-2 py-2 text-center"
                      >
                        {allowed ? (
                          <Check aria-hidden className="text-success mx-auto size-4" />
                        ) : (
                          <Minus aria-hidden className="text-ink-muted mx-auto size-4" />
                        )}
                        <span className="sr-only">
                          {allowed ? t('matrix.allowed') : t('matrix.denied')}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="text-ink-muted text-xs">{t('matrix.settingsNote')}</p>
    </section>
  );
}
