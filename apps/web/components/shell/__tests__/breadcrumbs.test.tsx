// @vitest-environment jsdom
// The topbar breadcrumb (#155, #1132): on a matter route the matter's id crumb shows the title the
// matter layout published through `<BreadcrumbLabel>`; without a label the decoded segment shows, and
// the label goes away when the route unmounts.
import { act, cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogs } from '../../../__tests__/helpers/intl.ts';
import { resetBreadcrumbLabels, setBreadcrumbLabel } from '../../../lib/breadcrumb-labels.ts';
import { testWorkspaceContext } from '../../../__tests__/helpers/workspace.ts';
import { BreadcrumbLabel } from '../breadcrumb-label.tsx';
import { Breadcrumbs } from '../breadcrumbs.tsx';

import { renderWithIntl } from './helpers.tsx';

const MATTER = '00000000-0000-4000-8000-d20000000009';

vi.mock('next/navigation', () => ({
  usePathname: () => `/w/demo/matters/${MATTER}/copilot`,
}));

const { workspace } = testWorkspaceContext();

const Intl = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
    {children}
  </NextIntlClientProvider>
);

afterEach(() => {
  cleanup();
  resetBreadcrumbLabels();
});

describe('breadcrumbs on a matter route', () => {
  it('shows the matter title instead of its id', () => {
    setBreadcrumbLabel(MATTER, 'Ravi v. State');
    const { container } = renderWithIntl(<Breadcrumbs workspace={workspace} />);
    const nav = container.querySelector('nav') as HTMLElement;
    expect(nav.textContent).toContain('Ravi v. State');
    expect(nav.textContent).not.toContain(MATTER);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Copilot');
    const link = [...nav.querySelectorAll('a')].find((a) => a.textContent === 'Ravi v. State');
    expect(link?.getAttribute('href')).toBe(`/w/demo/matters/${MATTER}`);
  });

  it('falls back to the segment when no label is registered', () => {
    const { container } = renderWithIntl(<Breadcrumbs workspace={workspace} />);
    expect(container.querySelector('nav')?.textContent).toContain(MATTER);
  });

  it('takes the label from <BreadcrumbLabel> and drops it on unmount', () => {
    const { container, rerender } = render(
      <>
        <Breadcrumbs workspace={workspace} />
        <BreadcrumbLabel segment={MATTER} label="Ravi v. State" />
      </>,
      { wrapper: Intl },
    );
    const nav = () => container.querySelector('nav') as HTMLElement;
    expect(nav().textContent).toContain('Ravi v. State');
    act(() => {
      rerender(<Breadcrumbs workspace={workspace} />);
    });
    expect(nav().textContent).toContain(MATTER);
    expect(nav().textContent).not.toContain('Ravi v. State');
  });

  it('a stale remover does not drop a newer label', () => {
    const removeOld = setBreadcrumbLabel(MATTER, 'Old title');
    setBreadcrumbLabel(MATTER, 'New title');
    removeOld();
    const { container } = renderWithIntl(<Breadcrumbs workspace={workspace} />);
    expect(container.querySelector('nav')?.textContent).toContain('New title');
  });
});
