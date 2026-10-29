// @vitest-environment jsdom
// The onboarding wizard components (#92): path chooser, stepper, the workspace, profile, courts and
// invite steps, the role explainer, the shell's keyboard and the first-day reveal. Every string
// comes from the catalogs; actions are injected, so no server runs.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompleteStep, StepScope } from '../components/onboarding/steps.ts';
import { catalogs, type TestLocale } from './helpers/intl.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { PathChooser } = await import('../components/onboarding/path-chooser.tsx');
const { Stepper } = await import('../components/onboarding/stepper.tsx');
const { WorkspaceStep } = await import('../components/onboarding/workspace-step.tsx');
const { ProfileForm } = await import('../components/onboarding/profile-form.tsx');
const { CourtPicker } = await import('../components/onboarding/court-picker.tsx');
const { InviteTable } = await import('../components/onboarding/invite-table.tsx');
const { RoleExplainer } = await import('../components/onboarding/role-explainer.tsx');
const { WizardShell } = await import('../components/onboarding/wizard-shell.tsx');
const { FirstDayReveal } = await import('../components/onboarding/first-day-reveal.tsx');

const en = catalogs.en.onboarding;

const withIntl = (ui: ReactElement, locale: TestLocale = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

// Radix (the bar council select, the checkboxes) measures with ResizeObserver, absent in jsdom.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
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

const WS = '00000000-0000-4000-8000-00000000a001';
const completeOk = (next: string | null) =>
  vi.fn<CompleteStep>(() =>
    Promise.resolve({ ok: true, data: { path: 'solo' as const, next: next as never } }),
  );
const scopeOf = (completeStep: CompleteStep, path: 'solo' | 'chamber' = 'solo'): StepScope => ({
  workspaceId: WS,
  slug: 'meera-raman',
  path,
  completeStep,
});

describe('path chooser', () => {
  it('offers Solo and Chamber, states data residency and links the security page', () => {
    withIntl(<PathChooser resume={null} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.chooser.title);
    const solo = screen.getByRole('link', { name: new RegExp(en.chooser.solo.cta) });
    const chamber = screen.getByRole('link', { name: new RegExp(en.chooser.chamber.cta) });
    expect(solo.getAttribute('href')).toBe('/onboarding/solo/workspace');
    expect(chamber.getAttribute('href')).toBe('/onboarding/chamber/workspace');
    expect(screen.getByText(new RegExp(en.india.body))).toBeTruthy();
    expect(screen.getByRole('link', { name: en.india.link }).getAttribute('href')).toBe(
      '/security',
    );
  });

  it('shows a resume card for a set-up in progress', () => {
    withIntl(
      <PathChooser
        resume={{ href: '/onboarding/solo/courts?w=meera', workspace: 'meera', step: 3, total: 6 }}
      />,
    );
    const resume = screen.getByRole('link', { name: en.chooser.resume.cta });
    expect(resume.getAttribute('href')).toBe('/onboarding/solo/courts?w=meera');
    expect(screen.getByText(/step 3 of 6 in meera/)).toBeTruthy();
  });
});

describe('stepper', () => {
  it('is an ordered list with aria-current on the current step only', () => {
    withIntl(
      <Stepper
        steps={[
          { id: 'workspace', label: 'Workspace', state: 'done' },
          { id: 'profile', label: 'Profile', state: 'current' },
          { id: 'courts', label: 'Courts', state: 'upcoming' },
        ]}
      />,
    );
    const list = document.querySelector('ol');
    expect(list).toBeTruthy();
    const current = list?.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current?.[0]?.getAttribute('data-step')).toBe('profile');
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
  });
});

describe('workspace step', () => {
  const create = async (name: string) => {
    fireEvent.change(screen.getByRole('textbox', { name: new RegExp(en.workspace.nameLabel) }), {
      target: { value: name },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.workspace.submit }));
      await Promise.resolve();
    });
  };

  it('links an empty-name error with aria-describedby and never calls the action', async () => {
    const action = vi.fn();
    withIntl(<WorkspaceStep path="solo" action={action} />);
    await create('  ');
    const field = screen.getByRole('textbox', { name: new RegExp(en.workspace.nameLabel) });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const error = document.getElementById(field.getAttribute('aria-describedby') ?? '');
    expect(error?.textContent).toContain(en.workspace.errors.nameRequired);
    expect(action).not.toHaveBeenCalled();
  });

  it('creates the workspace of the chosen path and opens the next step, resuming by slug', async () => {
    const action = vi.fn(() => Promise.resolve({ ok: true as const, data: { slug: 'hebbal' } }));
    withIntl(<WorkspaceStep path="chamber" action={action} />);
    await create(' Hebbal Chambers ');
    expect(action).toHaveBeenCalledWith({ name: 'Hebbal Chambers', kind: 'chamber' });
    expect(router.push).toHaveBeenCalledWith('/onboarding/chamber/invite?w=hebbal');
  });

  it('opens the profile after a solo workspace', async () => {
    const action = vi.fn(() => Promise.resolve({ ok: true as const, data: { slug: 'meera' } }));
    withIntl(<WorkspaceStep path="solo" action={action} />);
    await create('Meera Raman');
    expect(router.push).toHaveBeenCalledWith('/onboarding/solo/profile?w=meera');
  });

  it('keeps the form and says nothing was saved on a failure', async () => {
    const action = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'INTERNAL' as const, message: 'raw' } }),
    );
    withIntl(<WorkspaceStep path="solo" action={action} />);
    await create('Meera');
    expect(screen.getByRole('alert').textContent).toContain(en.workspace.errors.generic);
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('profile form', () => {
  it('lists the languages in their own script, Tamil and Kannada included', () => {
    withIntl(<ProfileForm scope={scopeOf(completeOk('courts'))} />);
    expect(screen.getByText(/தமிழ்/)).toBeTruthy();
    expect(screen.getByText(/ಕನ್ನಡ/)).toBeTruthy();
    const enrolment = screen.getByRole('textbox', { name: new RegExp(en.profile.enrolmentLabel) });
    expect(enrolment.getAttribute('autocomplete')).toBe('off');
  });

  it('summarises errors and links each to its field', async () => {
    const complete = completeOk('courts');
    withIntl(<ProfileForm scope={scopeOf(complete)} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.nav.next }));
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toContain(en.profile.errors.summary);
    const enrolment = screen.getByRole('textbox', { name: new RegExp(en.profile.enrolmentLabel) });
    expect(enrolment.getAttribute('aria-invalid')).toBe('true');
    // The hint and the error are both linked; one of the described-by elements is the error.
    const described = (enrolment.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '');
    expect(described.some((text) => text.includes(en.profile.errors.enrolment))).toBe(true);
    expect(complete).not.toHaveBeenCalled();
  });

  it('submits a valid profile and opens the next step', async () => {
    const complete = completeOk('courts');
    withIntl(
      <ProfileForm
        scope={scopeOf(complete)}
        initial={{
          enrolmentNumber: 'MS/1234/2019',
          barCouncil: 'tamil_nadu_puducherry',
          practiceAreas: ['civil'],
          languages: ['en', 'ta'],
        }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.nav.next }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(complete).toHaveBeenCalledWith({
        workspaceId: WS,
        step: 'profile',
        payload: {
          enrolmentNumber: 'MS/1234/2019',
          barCouncil: 'tamil_nadu_puducherry',
          practiceAreas: ['civil'],
          languages: ['en', 'ta'],
        },
      });
    });
    expect(router.push).toHaveBeenCalledWith('/onboarding/solo/courts?w=meera-raman');
  });

  it('does not submit offline', () => {
    online = false;
    const complete = completeOk('courts');
    withIntl(
      <ProfileForm
        scope={scopeOf(complete)}
        initial={{
          enrolmentNumber: 'MS/1234/2019',
          barCouncil: 'karnataka',
          practiceAreas: ['civil'],
          languages: ['en'],
        }}
      />,
    );
    const button = screen.getByRole('button', { name: en.nav.next });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(complete).not.toHaveBeenCalled();
  });

  it.each(['ta', 'kn'] as const)('renders %s strings only', (locale) => {
    withIntl(<ProfileForm scope={scopeOf(completeOk('courts'))} />, locale);
    const local = catalogs[locale].onboarding.profile;
    expect(document.body.textContent).toContain(local.enrolmentLabel);
    expect(document.body.textContent).not.toContain(en.profile.enrolmentLabel);
  });
});

describe('court picker', () => {
  const courts = [
    { code: 'in.tn.madras-hc.principal.original', label: 'Madras High Court, Principal Seat' },
    { code: 'in.ka.karnataka-hc.bengaluru', label: 'High Court of Karnataka, Principal Bench' },
  ];

  it('preselects the default court for the city and says so', () => {
    withIntl(
      <CourtPicker
        scope={scopeOf(completeOk('import'))}
        courts={courts}
        defaultCodes={['in.tn.madras-hc.principal.original']}
        defaultCity="Chennai"
      />,
    );
    const list = screen.getByRole('region', { name: en.courts.listLabel });
    expect(within(list).getByText(/Madras High Court/)).toBeTruthy();
    expect(screen.getByText(/High Court in Chennai/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('1 court chosen');
  });

  it('removes a court and refuses to continue with none', async () => {
    const complete = completeOk('import');
    withIntl(
      <CourtPicker
        scope={scopeOf(complete)}
        courts={courts}
        defaultCodes={['in.tn.madras-hc.principal.original']}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Remove Madras High Court/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.nav.next }));
      await Promise.resolve();
    });
    expect(screen.getByText(en.courts.errors.required)).toBeTruthy();
    expect(complete).not.toHaveBeenCalled();
  });

  it('submits the chosen codes', async () => {
    const complete = completeOk('import');
    withIntl(
      <CourtPicker
        scope={scopeOf(complete)}
        courts={courts}
        defaultCodes={['in.ka.karnataka-hc.bengaluru']}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.nav.next }));
      await Promise.resolve();
    });
    expect(complete).toHaveBeenCalledWith({
      workspaceId: WS,
      step: 'courts',
      payload: { forumCodes: ['in.ka.karnataka-hc.bengaluru'] },
    });
  });
});

describe('invite table', () => {
  const fill = (email: string) => {
    fireEvent.change(
      screen.getByRole('textbox', { name: new RegExp(`${en.invite.emailLabel} 1`) }),
      {
        target: { value: email },
      },
    );
  };
  const send = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.invite.send }));
      await Promise.resolve();
    });
  };

  it('marks an invalid address and sends nothing', async () => {
    const sendInvites = vi.fn();
    withIntl(<InviteTable scope={scopeOf(completeOk('roles'), 'chamber')} send={sendInvites} />);
    fill('not-an-email');
    await send();
    const field = screen.getByRole('textbox', { name: new RegExp(en.invite.emailLabel) });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(sendInvites).not.toHaveBeenCalled();
  });

  it('sends one invitation per role, starts the clerk restricted and completes the step', async () => {
    const complete = completeOk('roles');
    const sendInvites = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { results: [{ email: 'junior@example.test', status: 'sent' as const }] },
      }),
    );
    withIntl(<InviteTable scope={scopeOf(complete, 'chamber')} send={sendInvites} />);
    fill('Junior@Example.test');
    await send();
    await waitFor(() => {
      expect(complete).toHaveBeenCalledWith({ workspaceId: WS, step: 'invite' });
    });
    expect(sendInvites).toHaveBeenCalledWith({
      workspaceId: WS,
      emails: ['Junior@Example.test'],
      role: 'junior',
    });
    expect(en.invite.roles.clerk).toContain('restricted');
  });

  it('names a failed row and does not advance', async () => {
    const complete = completeOk('roles');
    const sendInvites = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { results: [{ email: 'a@example.test', status: 'conflict' as const }] },
      }),
    );
    withIntl(<InviteTable scope={scopeOf(complete, 'chamber')} send={sendInvites} />);
    fill('a@example.test');
    await send();
    expect(screen.getByRole('alert').textContent).toContain('a@example.test: already invited');
    expect(complete).not.toHaveBeenCalled();
  });

  it('can be skipped', async () => {
    const complete = completeOk('roles');
    withIntl(<InviteTable scope={scopeOf(complete, 'chamber')} send={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.nav.skip }));
      await Promise.resolve();
    });
    expect(complete).toHaveBeenCalledWith({ workspaceId: WS, step: 'invite', skipped: true });
  });
});

describe('role explainer', () => {
  it('says the clerk cannot see strategy notes or matter memory, and the matrix agrees', () => {
    withIntl(<RoleExplainer scope={scopeOf(completeOk('import'), 'chamber')} />);
    expect(screen.getByText(new RegExp(en.roles.explainer.slice(0, 40)))).toBeTruthy();
    const clerk = document.querySelector('[data-role="clerk"]');
    const cells = Array.from(clerk?.querySelectorAll('td') ?? []).map((cell) => cell.textContent);
    // Court day, briefs (limited), strategy notes and memory (cannot).
    expect(cells).toEqual([en.roles.can, en.roles.limited, en.roles.cannot, en.roles.cannot]);
  });
});

describe('wizard shell', () => {
  const steps = [
    { id: 'profile', label: 'Profile', state: 'current' as const },
    { id: 'courts', label: 'Courts', state: 'upcoming' as const },
  ];
  const shell = (backHref: string | null) =>
    withIntl(
      <WizardShell
        steps={steps}
        stepId="profile"
        title="Your practice profile"
        purpose="Tell us who you are."
        why="Why we ask: matching."
        backHref={backHref}
      >
        <button
          type="button"
          data-onboarding-primary=""
          onClick={() => {
            router.refresh();
          }}
        >
          Go
        </button>
      </WizardShell>,
    );

  it('has one h1, moves focus to it and shows the Why we ask line', () => {
    shell('/onboarding/solo/workspace');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    expect(screen.getByText(/Why we ask/)).toBeTruthy();
  });

  it('goes back on Shift+Enter and presses the primary button on Enter', () => {
    shell('/onboarding/solo/workspace');
    fireEvent.keyDown(document.body, { key: 'Enter', shiftKey: true });
    expect(router.push).toHaveBeenCalledWith('/onboarding/solo/workspace');
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('has no Back on the first step and opens the shortcut sheet from the footer', () => {
    shell(null);
    expect(screen.queryByRole('link', { name: en.nav.back })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.nav.shortcuts }));
    expect(screen.getByText(en.shortcuts.next)).toBeTruthy();
  });
});

describe('first-day reveal', () => {
  const reveal = (date: string | null, demo?: string) =>
    withIntl(
      <FirstDayReveal
        scope={scopeOf(completeOk(null))}
        firstDay={{ date, briefs: 4, openObligations: 7 }}
        boardHref="/w/meera-raman/today"
        briefsHref="/w/meera-raman/briefs"
        demoHref={demo}
      />,
    );

  it('says the court day for the next listed day is ready, with the counts', () => {
    reveal('2026-11-03');
    expect(screen.getByRole('status').textContent).toBe('Your court day for 03 Nov 2026 is ready.');
    expect(screen.getByText('4 briefs ready')).toBeTruthy();
    expect(screen.getByText('7 obligations in your starter queue')).toBeTruthy();
  });

  it('is never a dead end with nothing listed: guidance, the board and the demo', async () => {
    const complete = completeOk(null);
    withIntl(
      <FirstDayReveal
        scope={scopeOf(complete)}
        firstDay={{ date: null, briefs: 0, openObligations: 0 }}
        boardHref="/w/meera-raman/today"
        briefsHref="/w/meera-raman/briefs"
        demoHref="/w/demo/today"
      />,
    );
    expect(screen.getByRole('status').textContent).toBe(en.done.revealNone);
    expect(screen.getByRole('link', { name: en.done.demo }).getAttribute('href')).toBe(
      '/w/demo/today',
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.done.open }));
      await Promise.resolve();
    });
    expect(complete).toHaveBeenCalledWith({ workspaceId: WS, step: 'done' });
    expect(router.push).toHaveBeenCalledWith('/w/meera-raman/today');
  });

  it('hides the demo link when the member cannot open it', () => {
    reveal('2026-11-03');
    expect(screen.queryByRole('link', { name: en.done.demo })).toBeNull();
  });
});
