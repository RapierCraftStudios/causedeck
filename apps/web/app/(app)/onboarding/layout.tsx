import type { ReactNode } from 'react';

import { ThemeToggle } from '../../../components/theme-toggle.tsx';

/**
 * `/onboarding/**` (#92): the wizard has no workspace shell (the workspace may not exist yet): a
 * quiet header with the brand and the theme toggle, then the step. Signed-in only (proxy and the
 * `(app)` layout).
 */
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-4 py-3 md:px-6 xl:px-8">
        <span className="font-serif text-lg font-medium">CauseDeck</span>
        <ThemeToggle />
      </header>
      {children}
    </div>
  );
}
