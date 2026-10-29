// One wizard step (#92), shared by `solo/[step]` and `chamber/[step]`. The server decides what the
// member may see: the workspace comes from `?w=<slug>` (a refresh resumes it), membership is checked
// by the workspace loader and again by every core service, a step beyond the saved one redirects
// back to it (no jumping), and a chamber's owner-only steps are permission-denied for anyone else.
// Data is loaded first (a failed best-effort read becomes an empty value, never a thrown error);
// the step renders after, outside any try/catch.
import {
  defaultForumCodesFor,
  DEFAULT_CITY_BY_BAR_COUNCIL,
  isStepOf,
  stepsOf,
} from '@causedeck/validators/onboarding';
import type { OnboardingPath, OnboardingStep } from '@causedeck/validators/onboarding';
import { PermissionDenied } from '@causedeck/ui/patterns';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { BriefFormatForm } from '../../../../components/onboarding/brief-format-form.tsx';
import { ConfirmStep } from '../../../../components/onboarding/confirm-step.tsx';
import { CourtPicker, type CourtOption } from '../../../../components/onboarding/court-picker.tsx';
import { DelegationForm } from '../../../../components/onboarding/delegation-form.tsx';
import {
  FirstDayReveal,
  type FirstDay,
} from '../../../../components/onboarding/first-day-reveal.tsx';
import { type ForwardingAddress } from '../../../../components/onboarding/forward-instructions.tsx';
import { ImportStep } from '../../../../components/onboarding/import-step.tsx';
import { InviteTable } from '../../../../components/onboarding/invite-table.tsx';
import { BoardPreview, RolesPreview } from '../../../../components/onboarding/preview.tsx';
import { ProfileForm } from '../../../../components/onboarding/profile-form.tsx';
import { RoleExplainer } from '../../../../components/onboarding/role-explainer.tsx';
import type { StepperItem } from '../../../../components/onboarding/stepper.tsx';
import { courtDayHref, stepHref, type StepScope } from '../../../../components/onboarding/steps.ts';
import { WizardShell } from '../../../../components/onboarding/wizard-shell.tsx';
import { WorkspaceStep } from '../../../../components/onboarding/workspace-step.tsx';
import { memoryDeps } from '../../../../lib/memory/deps.ts';
import { can, type WorkspaceContext } from '../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../lib/workspace-loader.ts';
import { logger } from '../../../../src/health.ts';
import {
  createIntakeAddressAction,
  revokeIntakeAddressAction,
} from '../../w/[slug]/settings/integrations/email/actions.ts';
import { inviteMembersAction } from '../../w/[slug]/settings/members/actions.ts';

import { completeOnboardingStepAction, createWorkspaceAction } from '../actions.ts';

export interface StepPageProps {
  params: Promise<{ step: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** Steps only a chamber's owner may open (they decide who sees what). */
const OWNER_ONLY: readonly OnboardingStep[] = ['invite', 'roles', 'delegation', 'brief-format'];

async function loadCourts(context: WorkspaceContext): Promise<CourtOption[]> {
  const runtime = await import('@causedeck/core/runtime');
  const { listForums } = await import('@causedeck/core/court');
  const forums = await listForums(runtime.db, context.workspace.id);
  return forums.map((forum) => ({
    code: forum.code,
    label: [forum.court, forum.establishment].filter(Boolean).join(', '),
  }));
}

/** The city implied by the bar council the member already saved, for the courts default. */
async function loadDefaultCity(context: WorkspaceContext): Promise<string | undefined> {
  try {
    const runtime = await import('@causedeck/core/runtime');
    const { listMemory } = await import('@causedeck/core/memory');
    const actor = { workspaceId: context.workspace.id, userId: context.user.id };
    const items = await runtime.inWorkspace(actor, (tx) =>
      listMemory(memoryDeps(tx), actor, { layers: ['M1'] }),
    );
    const council = items.find((item) => item.key === 'M1.bar_council')?.value;
    return typeof council === 'string' ? DEFAULT_CITY_BY_BAR_COUNCIL[council] : undefined;
  } catch (error) {
    logger.warn({ err: error }, 'onboarding: could not read the bar council');
    return undefined;
  }
}

interface ImportData {
  channelEnabled: boolean;
  disclosureVersion: string;
  forwardAvailable: boolean;
  forwarding: ForwardingAddress | null;
}

async function loadImport(context: WorkspaceContext): Promise<ImportData> {
  const runtime = await import('@causedeck/core/runtime');
  const capture = await import('@causedeck/core/capture');
  const actor = { workspaceId: context.workspace.id, userId: context.user.id };
  const states = await runtime.inWorkspace(actor, (tx) =>
    capture.listChannels(tx, actor.workspaceId),
  );
  const channelEnabled = states.find((state) => state.channel === 'bulk_import')?.enabled ?? false;
  // Forwarding is best effort: dark flag, no credentials or a failed read never blocks the step.
  let forwardAvailable = false;
  let forwarding: ForwardingAddress | null = null;
  try {
    const { isEnabled } = await import('@causedeck/flags/server');
    forwardAvailable = await isEnabled('capture.email-forward', actor);
    if (forwardAvailable) {
      const { getActiveAddress } = await import('@causedeck/core/email-intake');
      const active = await runtime.inWorkspace(actor, (tx) =>
        getActiveAddress(tx, actor.workspaceId, actor.userId),
      );
      forwarding = active ? { id: active.id, address: active.address } : null;
    }
  } catch (error) {
    logger.warn({ err: error }, 'onboarding: forwarding address unavailable');
    forwardAvailable = false;
  }
  return {
    channelEnabled,
    disclosureVersion: capture.CAPTURE_DISCLOSURE_VERSION,
    forwardAvailable,
    forwarding,
  };
}

interface DoneData {
  firstDay: FirstDay;
  today: string;
  hasDemo: boolean;
}

async function loadDone(context: WorkspaceContext): Promise<DoneData> {
  const runtime = await import('@causedeck/core/runtime');
  const { getFirstCourtDay } = await import('@causedeck/core/onboarding');
  const { istDay } = await import('@causedeck/core/import');
  const { isDemoWorkspaceSlug } = await import('@causedeck/validators/workspace');
  const actor = { workspaceId: context.workspace.id, userId: context.user.id };
  const now = new Date();
  const firstDay = await runtime.inWorkspace(actor, (tx) => getFirstCourtDay(tx, actor, now));
  return {
    firstDay,
    today: istDay(now),
    hasDemo: context.memberships.some((m) => isDemoWorkspaceSlug(m.workspace.slug)),
  };
}

export async function OnboardingStepPage(path: OnboardingPath, props: StepPageProps) {
  const [{ step }, query] = await Promise.all([props.params, props.searchParams]);
  if (!isStepOf(path, step)) notFound();
  const t = await getTranslations('onboarding');

  // Step 1 creates the workspace, so there is no workspace to load yet.
  if (step === 'workspace') {
    return (
      <WizardShell
        steps={stepperItems(path, 'workspace', [], [], t)}
        stepId="workspace"
        title={t('steps.workspace.title')}
        purpose={t('steps.workspace.purpose')}
        why={t('steps.workspace.why')}
        backHref="/onboarding"
        needsNetwork
      >
        <WorkspaceStep path={path} action={createWorkspaceAction} />
      </WizardShell>
    );
  }

  const slug = first(query.w);
  if (slug === undefined) redirect('/onboarding');
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const runtime = await import('@causedeck/core/runtime');
  const onboarding = await import('@causedeck/core/onboarding');
  const actor = { workspaceId: context.workspace.id, userId: context.user.id };
  // Idempotent: opens the saved state, or starts one for a workspace made outside the wizard.
  const state = await runtime.inWorkspace(actor, (tx) =>
    onboarding.startOnboarding(tx, actor, { path }),
  );
  if (state.path !== path) redirect(stepHref(state.path, step, slug));
  const steps = stepsOf(path);
  if (steps.indexOf(step) > steps.indexOf(state.step)) redirect(stepHref(path, state.step, slug));

  const scope: StepScope = {
    workspaceId: context.workspace.id,
    slug,
    path,
    completeStep: completeOnboardingStepAction,
  };
  const items = stepperItems(path, step, state.completed, state.skipped, t);
  const previous = steps[steps.indexOf(step) - 1];
  const frame = {
    steps: items,
    stepId: step,
    title: t(`steps.${step}.title`),
    purpose: t(`steps.${step}.purpose`),
    why: t(`steps.${step}.why`),
    backHref: previous === undefined ? null : stepHref(path, previous, slug),
  };

  if (path === 'chamber' && OWNER_ONLY.includes(step) && context.role !== 'owner') {
    return (
      <WizardShell {...frame} title={t('states.deniedTitle')} purpose="" why="">
        <PermissionDenied message={t('states.denied')} />
      </WizardShell>
    );
  }

  switch (step) {
    case 'profile':
      return (
        <WizardShell {...frame} preview={<BoardPreview matters={[]} />}>
          <ProfileForm scope={scope} />
        </WizardShell>
      );
    case 'courts': {
      const [courts, city] = await Promise.all([loadCourts(context), loadDefaultCity(context)]);
      return (
        <WizardShell {...frame} preview={<BoardPreview matters={[]} />}>
          <CourtPicker
            scope={scope}
            courts={courts}
            defaultCodes={defaultForumCodesFor(city)}
            defaultCity={city}
          />
        </WizardShell>
      );
    }
    case 'invite':
      return (
        <WizardShell {...frame} needsNetwork preview={<RolesPreview />}>
          <InviteTable scope={scope} send={inviteMembersAction} />
        </WizardShell>
      );
    case 'roles':
      return (
        <WizardShell {...frame} preview={<RolesPreview />}>
          <RoleExplainer scope={scope} />
        </WizardShell>
      );
    case 'import': {
      if (!can(context.role, 'matter.write')) {
        return (
          <WizardShell {...frame}>
            <PermissionDenied message={t('import.denied')} />
          </WizardShell>
        );
      }
      const data = await loadImport(context);
      return (
        <WizardShell {...frame} needsNetwork preview={<BoardPreview matters={[]} />}>
          <ImportStep
            scope={scope}
            forward={{
              initial: data.forwarding,
              available: data.forwardAvailable,
              create: () => createIntakeAddressAction({ workspaceId: scope.workspaceId }),
              revoke: (addressId) =>
                revokeIntakeAddressAction({ workspaceId: scope.workspaceId, addressId }),
            }}
            channelEnabled={data.channelEnabled}
            canEnableChannel={can(context.role, 'workspace.manage')}
            disclosureVersion={data.disclosureVersion}
          />
        </WizardShell>
      );
    }
    case 'confirm': {
      const batch = first(query.batch);
      return (
        <WizardShell {...frame} needsNetwork>
          <ConfirmStep scope={scope} batchId={batch ?? null} />
        </WizardShell>
      );
    }
    case 'delegation': {
      const defaults = await loadChamberDefaults(actor);
      return (
        <WizardShell {...frame} preview={<RolesPreview />}>
          <DelegationForm scope={scope} initial={defaults.delegation} />
        </WizardShell>
      );
    }
    case 'brief-format': {
      const defaults = await loadChamberDefaults(actor);
      return (
        <WizardShell {...frame}>
          <BriefFormatForm scope={scope} initial={defaults.briefFormat} />
        </WizardShell>
      );
    }
    case 'done': {
      const done = await loadDone(context);
      const base = `/w/${encodeURIComponent(slug)}`;
      return (
        <WizardShell {...frame}>
          <FirstDayReveal
            scope={scope}
            firstDay={done.firstDay}
            boardHref={courtDayHref(slug, done.firstDay.date, done.today)}
            briefsHref={`${base}/briefs`}
            demoHref={done.hasDemo ? '/w/demo/today' : undefined}
          />
        </WizardShell>
      );
    }
    default:
      notFound();
  }
}

async function loadChamberDefaults(actor: { workspaceId: string; userId: string }) {
  const runtime = await import('@causedeck/core/runtime');
  const { getChamberDefaults } = await import('@causedeck/core/onboarding');
  return runtime.inWorkspace(actor, (tx) => getChamberDefaults(tx, actor));
}

type Translate = Awaited<ReturnType<typeof getTranslations<'onboarding'>>>;

function stepperItems(
  path: OnboardingPath,
  current: OnboardingStep,
  completed: readonly OnboardingStep[],
  skipped: readonly OnboardingStep[],
  t: Translate,
): StepperItem[] {
  return stepsOf(path).map((id) => ({
    id,
    label: t(`steps.${id}.label`),
    state:
      id === current
        ? 'current'
        : skipped.includes(id)
          ? 'skipped'
          : completed.includes(id)
            ? 'done'
            : 'upcoming',
  }));
}
