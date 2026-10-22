// @vitest-environment jsdom
// `/onboarding` create-workspace card (#179): segmented `Just me` / `A chamber`, name field,
// `Create workspace`, inline errors, every string from the catalogs.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateWorkspace } from '../app/(app)/onboarding/create-workspace-form.tsx';

import { catalogs, fakeGetTranslations, type TestLocale } from './helpers/intl.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('../app/(app)/onboarding/actions.ts', () => ({ createWorkspaceAction: vi.fn() }));

const { CreateWorkspaceForm } = await import('../app/(app)/onboarding/create-workspace-form.tsx');
const { default: OnboardingPage } = await import('../app/(app)/onboarding/page.tsx');

const en = catalogs.en.workspace.onboarding;

const withIntl = (ui: ReactElement, locale: TestLocale = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

let online = true;
beforeEach(() => {
  online = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const nameField = () => screen.getByRole('textbox', { name: new RegExp(en.nameLabel) });
const submit = () => screen.getByRole('button', { name: en.submit });

async function create(name: string) {
  fireEvent.change(nameField(), { target: { value: name } });
  await act(async () => {
    fireEvent.click(submit());
    await Promise.resolve();
  });
}

describe('onboarding page', () => {
  it('renders a single centred card with a serif title and the create form', async () => {
    withIntl(await OnboardingPage());
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(en.title);
    expect(heading.className).toContain('font-serif');
    expect(screen.getByRole('region', { name: en.title })).toBeTruthy();
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(submit()).toBeTruthy();
  });
});

describe('CreateWorkspaceForm', () => {
  it('offers Just me / A chamber as a labelled radio group, Just me first and selected', () => {
    withIntl(<CreateWorkspaceForm action={vi.fn<CreateWorkspace>()} />);
    const group = screen.getByRole('group', { name: en.kindLabel });
    const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type=radio]'));
    expect(radios.map((r) => r.value)).toEqual(['solo', 'chamber']);
    const solo = screen.getByRole('radio', { name: en.kind.solo });
    const chamber = screen.getByRole('radio', { name: en.kind.chamber });
    expect((solo as HTMLInputElement).checked).toBe(true);
    fireEvent.click(chamber);
    expect((chamber as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(en.kindHint.chamber)).toBeTruthy();
  });

  it('shows an inline error under the name and never calls the action for an empty name', async () => {
    const action = vi.fn<CreateWorkspace>();
    withIntl(<CreateWorkspaceForm action={action} />);
    await create('   ');
    const field = nameField();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const error = document.getElementById(field.getAttribute('aria-describedby') ?? '');
    expect(error?.textContent).toContain(en.errors.nameRequired);
    expect(action).not.toHaveBeenCalled();
  });

  it('creates the chosen kind and goes to the new workspace Today', async () => {
    const action = vi.fn<CreateWorkspace>(() =>
      Promise.resolve({ ok: true, data: { slug: 'hebbal-chambers' } }),
    );
    withIntl(<CreateWorkspaceForm action={action} />);
    fireEvent.click(screen.getByRole('radio', { name: en.kind.chamber }));
    await create(' Hebbal Chambers ');
    expect(action).toHaveBeenCalledWith({ name: 'Hebbal Chambers', kind: 'chamber' });
    expect(router.push).toHaveBeenCalledWith('/w/hebbal-chambers/today');
  });

  it('maps a server VALIDATION to the inline name error', async () => {
    const action = vi.fn<CreateWorkspace>(() =>
      Promise.resolve({ ok: false, error: { code: 'VALIDATION', message: 'Bad name' } }),
    );
    withIntl(<CreateWorkspaceForm action={action} />);
    await create('!!!');
    expect(screen.getByText(en.errors.nameInvalid)).toBeTruthy();
    expect(screen.queryByText('Bad name')).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows other failures as a form alert in catalog copy', async () => {
    const action = vi.fn<CreateWorkspace>(() =>
      Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: 'raw' } }),
    );
    withIntl(<CreateWorkspaceForm action={action} />);
    await create('Solo practice');
    expect(screen.getByRole('alert').textContent).toContain(en.errors.generic);
  });

  it('does not submit offline', async () => {
    online = false;
    const action = vi.fn<CreateWorkspace>();
    withIntl(<CreateWorkspaceForm action={action} />);
    await create('Solo practice');
    expect(screen.getByRole('alert').textContent).toContain(en.errors.offline);
    expect(action).not.toHaveBeenCalled();
  });

  it.each(['ta', 'kn'] as const)('renders only %s catalog strings', (locale) => {
    withIntl(<CreateWorkspaceForm action={vi.fn<CreateWorkspace>()} />, locale);
    const text = document.body.textContent;
    const local = catalogs[locale].workspace.onboarding;
    expect(text).toContain(local.kind.solo);
    expect(text).toContain(local.submit);
    for (const english of [en.kind.solo, en.kind.chamber, en.submit, en.nameLabel]) {
      expect(text).not.toContain(english);
    }
  });
});
