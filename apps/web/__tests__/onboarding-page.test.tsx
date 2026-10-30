// @vitest-environment jsdom
// The wizard step page (#92): what the server decides before any step renders. An unknown step is
// a 404, a missing workspace goes back to the chooser, a step beyond the saved one redirects to the
// saved step (no jumping), a path mismatch follows the saved path, and a chamber's owner-only steps
// are permission-denied for everyone but the owner. Components are stand-ins; they have their own
// tests (onboarding.test.tsx).
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

interface SavedState {
  path: 'solo' | 'chamber';
  step: string;
  completed: string[];
  skipped: string[];
}
const state = vi.hoisted((): { context: WorkspaceContext | null; saved: SavedState } => ({
  context: null,
  saved: { path: 'solo', step: 'profile', completed: ['workspace'], skipped: [] },
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(state.context),
}));
vi.mock('../lib/memory/deps.ts', () => ({ memoryDeps: (tx: unknown) => ({ db: tx }) }));
vi.mock('../src/health.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@causedeck/core/runtime', () => ({
  db: {},
  inWorkspace: (_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('@causedeck/core/onboarding', () => ({
  startOnboarding: () =>
    Promise.resolve({ ...state.saved, finished: false, updatedAt: new Date(0) }),
  getChamberDefaults: () =>
    Promise.resolve({
      delegation: { suggestAssignments: true, defaultCapacity: 'assisting', notifyAssignee: true },
      briefFormat: 'full',
    }),
  getFirstCourtDay: () => Promise.resolve({ date: null, briefs: 0, openObligations: 0 }),
}));
vi.mock('../app/(app)/onboarding/actions.ts', () => ({
  completeOnboardingStepAction: vi.fn(),
  createWorkspaceAction: vi.fn(),
}));
vi.mock('../app/(app)/w/[slug]/settings/members/actions.ts', () => ({
  inviteMembersAction: vi.fn(),
}));
vi.mock('../app/(app)/w/[slug]/settings/integrations/email/actions.ts', () => ({
  createIntakeAddressAction: vi.fn(),
  revokeIntakeAddressAction: vi.fn(),
}));
// Client step components stand in with a marker.
const marker = (name: string) => () => <div data-testid={name} />;
vi.mock('../components/onboarding/wizard-shell.tsx', () => ({
  WizardShell: ({ stepId, children }: { stepId: string; children: ReactNode }) => (
    <section data-testid="shell" data-step={stepId}>
      {children}
    </section>
  ),
}));
vi.mock('../components/onboarding/workspace-step.tsx', () => ({
  WorkspaceStep: marker('workspace'),
}));
vi.mock('../components/onboarding/profile-form.tsx', () => ({ ProfileForm: marker('profile') }));
vi.mock('../components/onboarding/role-explainer.tsx', () => ({ RoleExplainer: marker('roles') }));
vi.mock('../components/onboarding/invite-table.tsx', () => ({ InviteTable: marker('invite') }));
vi.mock('../components/onboarding/delegation-form.tsx', () => ({
  DelegationForm: marker('delegation'),
}));
vi.mock('../components/onboarding/preview.tsx', () => ({
  BoardPreview: () => null,
  RolesPreview: () => null,
}));

const { OnboardingStepPage } = await import('../app/(app)/onboarding/_components/step-page.tsx');

const page = (
  path: 'solo' | 'chamber',
  step: string,
  query: Record<string, string> = { w: 'meera' },
) =>
  OnboardingStepPage(path, {
    params: Promise.resolve({ step }),
    searchParams: Promise.resolve(query),
  });

const show = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  state.context = testWorkspaceContext('demo', 'owner');
  state.saved = { path: 'solo', step: 'profile', completed: ['workspace'], skipped: [] };
});
afterEach(() => {
  cleanup();
});

describe('onboarding step page', () => {
  it('404s a step that is not on the path', async () => {
    await expect(page('solo', 'invite')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(page('chamber', 'courts')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders the workspace step without a workspace (it creates one)', async () => {
    state.context = null;
    show(await page('solo', 'workspace', {}));
    expect(screen.getByTestId('workspace')).toBeTruthy();
  });

  it('goes back to the chooser when no workspace is named', async () => {
    await expect(page('solo', 'profile', {})).rejects.toThrow('REDIRECT:/onboarding');
  });

  it('404s a workspace the member does not belong to', async () => {
    state.context = null;
    await expect(page('solo', 'profile')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders the saved step', async () => {
    show(await page('solo', 'profile'));
    expect(screen.getByTestId('profile')).toBeTruthy();
    expect(screen.getByTestId('shell').getAttribute('data-step')).toBe('profile');
  });

  it('sends a step beyond the saved one back to it', async () => {
    await expect(page('solo', 'done')).rejects.toThrow('REDIRECT:/onboarding/solo/profile?w=meera');
  });

  it('follows the saved path when the URL names the other', async () => {
    await expect(page('chamber', 'roles')).rejects.toThrow(
      'REDIRECT:/onboarding/solo/roles?w=meera',
    );
  });

  it('is permission-denied for a chamber step when the member is not the owner', async () => {
    state.saved = { path: 'chamber', step: 'invite', completed: ['workspace'], skipped: [] };
    state.context = testWorkspaceContext('demo', 'junior');
    show(await page('chamber', 'invite'));
    expect(screen.queryByTestId('invite')).toBeNull();
    expect(screen.getByText(catalogs.en.onboarding.states.denied)).toBeTruthy();
  });

  it('shows the chamber owner their step', async () => {
    state.saved = {
      path: 'chamber',
      step: 'roles',
      completed: ['workspace', 'invite'],
      skipped: [],
    };
    show(await page('chamber', 'roles'));
    expect(screen.getByTestId('roles')).toBeTruthy();
  });
});
