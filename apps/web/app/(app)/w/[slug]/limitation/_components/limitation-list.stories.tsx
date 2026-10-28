// Limitation tracker (#941, #84 part 3): populated (proposed and confirmed), empty, no reviewed
// rules, gated notice, clerk view (due dates only), offline, the route's loading, error and denied
// states, and the shortcuts (p, Enter, Esc). Actions are mocked and all rules are fictional.
// Export names carry the `Limitation` prefix: story names are unique across apps/web.
import type { ComputationView, RuleView } from '@causedeck/core/limitation';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';

import { PermissionDeniedPage } from '../../../../../components/shell/permission-denied-page.tsx';
import type { Result } from '../../../../../lib/safe-action.ts';
import LimitationError from '../error.tsx';
import LimitationLoading from '../loading.tsx';
import { LimitationGatedNotice } from './gated-notice.tsx';
import type { LimitationActions } from './limitation-actions.ts';
import { LimitationList } from './limitation-list.tsx';
import { NoRulesNotice } from './no-rules-notice.tsx';

type Done = Result<{ id: string; expiresOn: string }>;
const done = (): Promise<Done> =>
  Promise.resolve({ ok: true, data: { id: 'c', expiresOn: '2027-01-31' } });

const actions = (): LimitationActions => ({ compute: fn(done), confirm: fn(done) });

const RULE: RuleView = {
  id: '00000000-0000-4000-8000-0000000c0001',
  code: 'synthetic_appeal',
  title: 'Synthetic appeal period',
  statute: 'Fictional Act, s. 1',
  periodValue: 90,
  periodUnit: 'days',
  startEvent: 'judgment_date',
  condonable: true,
  citation: null,
  tableVersion: '1',
  reviewed: true,
  draft: false,
};

const computation = (n: number, over: Partial<ComputationView> = {}): ComputationView => ({
  id: `00000000-0000-4000-8000-0000000d00${String(n).padStart(2, '0')}`,
  matterId: '00000000-0000-4000-8000-0000000a0001',
  expiresOn: '2027-01-31',
  status: 'proposed',
  ruleId: RULE.id,
  ruleCode: RULE.code,
  ruleVersion: '1',
  startDate: '2026-11-02',
  excludedDays: 0,
  notes: ['Delay may be condoned on application.'],
  ...over,
});

const PROPOSED = computation(1);
const CONFIRMED = computation(2, { status: 'confirmed', expiresOn: '2027-03-15' });
const COMPUTATIONS = [PROPOSED, CONFIRMED];

const meta = {
  title: 'Limitation/LimitationList',
  component: LimitationList,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    computations: COMPUTATIONS,
    rules: [RULE],
    canWrite: true,
    actions: actions(),
    forceOffline: false,
  },
} satisfies Meta<typeof LimitationList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LimitationListDefault: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('listitem')).toHaveLength(2);
    await expect(
      canvas.getByText("Computed from your counsel's rule table. Verify before relying on it."),
    ).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  },
};

export const LimitationListEmpty: Story = {
  args: { computations: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No limitation dates yet')).toBeVisible();
  },
};

/** No reviewed rule: the notice shows and Propose is off. */
export const LimitationListNoRules: Story = {
  args: { computations: [], rules: [] },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <NoRulesNotice />
      <LimitationList {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No reviewed rule table')).toBeVisible();
    await expect(canvas.getAllByRole('button', { name: 'Propose a date' })[0]).toBeDisabled();
  },
};

export const LimitationListGatedNotice: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      <LimitationGatedNotice />
      <LimitationList {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/A computed date is a proposal/)).toBeVisible();
  },
};

/** A clerk or viewer: due dates only, no rule, no Propose, no Confirm. */
export const LimitationListClerk: Story = {
  args: {
    canWrite: false,
    rules: [],
    computations: [
      {
        id: CONFIRMED.id,
        matterId: CONFIRMED.matterId,
        expiresOn: '2027-03-15',
        status: 'confirmed',
      },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Propose a date' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Show working' })).toBeNull();
  },
};

export const LimitationListOffline: Story = {
  args: { forceOffline: true },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('button', { name: 'Propose a date' })[0]).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  },
};

/** The route's skeleton (loading.tsx). */
export const LimitationListLoading: Story = {
  render: () => <LimitationLoading />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading limitation dates')).toBeInTheDocument();
  },
};

/** The route's error boundary (error.tsx). */
export const LimitationListError: Story = {
  render: () => <LimitationError error={new Error('boom')} reset={fn()} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Could not load limitation dates')).toBeVisible();
  },
};

/** A role without access sees the permission-denied page. */
export const LimitationListDenied: Story = {
  render: () => <PermissionDeniedPage />,
};

export const LimitationListWorking: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(
      canvas.getAllByRole('button', { name: 'Show working' })[0] as HTMLElement,
    );
    await expect(canvas.getByText('How this date was computed')).toBeVisible();
  },
};

export const LimitationListProposeShortcut: Story = {
  play: async () => {
    await userEvent.keyboard('p');
    await expect(await screen.findByRole('dialog')).toBeVisible();
    await userEvent.keyboard('{Escape}');
  },
};

export const LimitationListConfirmShortcut: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.tab();
    await expect(canvas.getAllByRole('listitem')[0]).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.actions.confirm).toHaveBeenCalled();
  },
};

export const LimitationListEscapeShortcut: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await userEvent.keyboard('{Escape}');
    await expect(canvas.getAllByRole('listitem')[0]).not.toHaveAttribute('data-selected');
  },
};
