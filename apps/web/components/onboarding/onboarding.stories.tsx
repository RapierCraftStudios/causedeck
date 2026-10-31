// The onboarding wizard (#92): the path chooser, stepper, each step, the shell, the first-day
// reveal and the loading, error, offline and permission-denied states. Everything is a synchronous
// component with `useTranslations` (async server components cannot render in Storybook); actions are
// mocked and all names are fictional. Export names carry the `Onboarding` prefix: story names are
// unique across apps/web. A render-critique and a founder visual pass are still owed (#92).
import { PermissionDenied } from '@causedeck/ui/patterns';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import OnboardingError from '../../app/(app)/onboarding/error.tsx';
import OnboardingLoading from '../../app/(app)/onboarding/loading.tsx';
import type { Result } from '../../lib/safe-action.ts';

import { BriefFormatForm } from './brief-format-form.tsx';
import { CourtPicker } from './court-picker.tsx';
import { DelegationForm } from './delegation-form.tsx';
import { FirstDayReveal } from './first-day-reveal.tsx';
import { InviteTable } from './invite-table.tsx';
import { PathChooser } from './path-chooser.tsx';
import { BoardPreview, RolesPreview } from './preview.tsx';
import { ProfileForm } from './profile-form.tsx';
import { RoleExplainer } from './role-explainer.tsx';
import { Stepper } from './stepper.tsx';
import type { CompleteStep, StepScope } from './steps.ts';
import { WizardShell } from './wizard-shell.tsx';
import { WorkspaceStep } from './workspace-step.tsx';

const ok = <T,>(data: T): Promise<Result<T>> => Promise.resolve({ ok: true, data });
const completeStep = fn<CompleteStep>(() => ok({ path: 'solo' as const, next: 'courts' as const }));
const scope = (path: 'solo' | 'chamber' = 'solo'): StepScope => ({
  workspaceId: '00000000-0000-4000-8000-00000000a001',
  slug: 'meera-raman',
  path,
  completeStep,
});

const STEPS = [
  { id: 'workspace', label: 'Workspace', state: 'done' as const },
  { id: 'profile', label: 'Profile', state: 'current' as const },
  { id: 'courts', label: 'Courts', state: 'upcoming' as const },
  { id: 'import', label: 'Import', state: 'upcoming' as const },
  { id: 'confirm', label: 'Confirm', state: 'upcoming' as const },
  { id: 'done', label: 'Ready', state: 'upcoming' as const },
];

const meta = {
  title: 'Onboarding/Wizard',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnboardingChooser: Story = { render: () => <PathChooser resume={null} /> };

export const OnboardingChooserResume: Story = {
  render: () => (
    <PathChooser
      resume={{
        href: '/onboarding/solo/courts?w=meera-raman',
        workspace: 'meera-raman',
        step: 3,
        total: 6,
      }}
    />
  ),
};

export const OnboardingStepper: Story = {
  render: () => (
    <div className="max-w-sm p-4">
      <Stepper steps={STEPS} />
    </div>
  ),
};

const frame = (children: React.ReactNode, title: string, preview?: React.ReactNode) => (
  <WizardShell
    steps={STEPS}
    stepId="profile"
    title={title}
    purpose="Tell us who you are, so we can recognise your matters in a cause list."
    why="Why we ask: your enrolment number is how we match listings to you, and nothing else."
    backHref="/onboarding/solo/workspace"
    preview={preview}
  >
    {children}
  </WizardShell>
);

export const OnboardingWorkspaceStep: Story = {
  render: () => (
    <WizardShell
      steps={STEPS.map((step, i) => ({
        ...step,
        state: i === 0 ? ('current' as const) : ('upcoming' as const),
      }))}
      stepId="workspace"
      title="Name your workspace"
      purpose="This is where your matters, briefs and court days will live."
      why="Why we ask: your workspace keeps your data apart from everyone else's."
      backHref="/onboarding"
    >
      <WorkspaceStep path="solo" action={fn(() => ok({ slug: 'meera-raman' }))} />
    </WizardShell>
  ),
  play: async () => {
    const body = within(document.body);
    await expect(body.getByText(/stored in India/)).toBeInTheDocument();
  },
};

export const OnboardingProfileStep: Story = {
  render: () =>
    frame(<ProfileForm scope={scope()} />, 'Your practice profile', <BoardPreview matters={[]} />),
  play: async () => {
    const body = within(document.body);
    await userEvent.click(body.getByRole('button', { name: 'Continue' }));
    await expect(body.getByRole('alert')).toBeInTheDocument();
  },
};

export const OnboardingCourtsStep: Story = {
  render: () =>
    frame(
      <CourtPicker
        scope={scope()}
        courts={[
          {
            code: 'in.tn.madras-hc.principal.original',
            label: 'Madras High Court, Principal Seat, Original Side',
          },
          {
            code: 'in.tn.madras-hc.principal.appellate',
            label: 'Madras High Court, Principal Seat, Appellate Side',
          },
          {
            code: 'in.ka.karnataka-hc.bengaluru',
            label: 'High Court of Karnataka, Principal Bench',
          },
        ]}
        defaultCodes={['in.tn.madras-hc.principal.original', 'in.tn.madras-hc.principal.appellate']}
        defaultCity="Chennai"
      />,
      'Where do you appear?',
    ),
};

export const OnboardingInviteStep: Story = {
  render: () =>
    frame(
      <InviteTable
        scope={scope('chamber')}
        send={fn(() => ok({ results: [{ email: 'junior@example.com', status: 'sent' as const }] }))}
      />,
      'Invite your chamber',
      <RolesPreview />,
    ),
};

export const OnboardingRolesStep: Story = {
  render: () =>
    frame(<RoleExplainer scope={scope('chamber')} />, 'Who can see what', <RolesPreview />),
};

export const OnboardingDelegationStep: Story = {
  render: () => frame(<DelegationForm scope={scope('chamber')} />, 'Delegation defaults'),
};

export const OnboardingBriefFormatStep: Story = {
  render: () => frame(<BriefFormatForm scope={scope('chamber')} />, 'Your brief format'),
};

export const OnboardingFirstDay: Story = {
  render: () =>
    frame(
      <FirstDayReveal
        scope={scope()}
        firstDay={{ date: '2026-11-03', briefs: 4, openObligations: 7 }}
        boardHref="/w/meera-raman/today"
        briefsHref="/w/meera-raman/briefs"
        demoHref="/demo"
      />,
      'You are set up',
    ),
};

export const OnboardingFirstDayEmpty: Story = {
  render: () =>
    frame(
      <FirstDayReveal
        scope={scope()}
        firstDay={{ date: null, briefs: 0, openObligations: 0 }}
        boardHref="/w/meera-raman/today"
        briefsHref="/w/meera-raman/briefs"
        demoHref="/demo"
      />,
      'You are set up',
    ),
};

export const OnboardingLoadingState: Story = { render: () => <OnboardingLoading /> };

export const OnboardingErrorState: Story = {
  render: () => (
    <OnboardingError error={Object.assign(new Error('x'), { digest: 'ab12cd' })} reset={fn()} />
  ),
};

export const OnboardingPermissionDenied: Story = {
  render: () =>
    frame(
      <PermissionDenied message="Only the chamber owner can do this step. Ask the owner to set it up, or to make you an owner." />,
      'This step is for the owner',
    ),
};
