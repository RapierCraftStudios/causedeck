// The live preview of the wizard (#92, from 1280 px): the court-day board taking shape for a solo
// advocate, the role matrix for a chamber. It sits on the raised surface and is decorative (the
// shell hides it from assistive technology): everything it says is in the form.
import { useTranslations } from 'next-intl';

import { RoleMatrix } from './role-explainer.tsx';

export function BoardPreview({ matters }: { matters: readonly string[] }) {
  const t = useTranslations('onboarding.preview');
  return (
    <div data-slot="board-preview" className="flex flex-col gap-3">
      <p className="font-serif text-lg font-medium">{t('title')}</p>
      {matters.length === 0 ? (
        <p className="text-ink-muted text-sm">{t('boardEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {matters.map((matter) => (
            <li key={matter} className="bg-surface border-line rounded-md border p-3 text-sm">
              {matter}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RolesPreview() {
  const t = useTranslations('onboarding.preview');
  return (
    <div data-slot="roles-preview" className="flex flex-col gap-3">
      <p className="font-serif text-lg font-medium">{t('matrixTitle')}</p>
      <RoleMatrix />
    </div>
  );
}
