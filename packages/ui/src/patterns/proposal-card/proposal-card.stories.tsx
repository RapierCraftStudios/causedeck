import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarDays } from 'lucide-react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { ANCHORS, INDIC_PROPOSALS, LONG_PROPOSAL, PROPOSALS } from '../__fixtures__/trust';
import type { Proposal } from '../types';
import { ProposalCard } from './proposal-card';
import { ProposalCardGroup } from './proposal-card-group';

const StringGroup = ProposalCardGroup<string>;

const ANCHORS_BY_ID = Object.fromEntries(
  Object.values(ANCHORS).map((anchor) => [anchor.id, anchor]),
);

const meta = {
  title: 'Patterns/ProposalCard',
  component: StringGroup,
  args: {
    proposals: PROPOSALS,
    anchors: ANCHORS_BY_ID,
    // Never settles, so stories rest in a stable state unless they pass their own.
    onConfirm: fn(() => new Promise<void>(() => undefined)),
    onEdit: fn(),
    onDismiss: fn(),
    onConfirmed: fn(),
  },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StringGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

const cardOf = (canvasElement: HTMLElement, title: string) =>
  within(canvasElement).getByRole('group', { name: title });

/** Three proposals, two marked safe by the caller; actions inline from 768 px, stacked below. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('list', { name: '3 need you' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('listitem')).toHaveLength(3);
    await expect(canvas.getByRole('button', { name: 'Confirm all safe' })).toBeVisible();
    const card = cardOf(canvasElement, 'Next hearing');
    await expect(within(card).getByRole('button', { name: /^Source:/ })).toBeVisible();
    await expect(within(card).getByRole('button', { name: 'Confirm' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Enter',
    );
  },
};

export const Hover: Story = {
  play: async ({ canvasElement }) => {
    const confirm = within(cardOf(canvasElement, 'Next hearing')).getByRole('button', {
      name: 'Confirm',
    });
    await userEvent.hover(confirm);
    await expect(confirm).toBeEnabled();
  },
};

/** Tab reaches the card itself (one roving stop for the list). */
export const FocusVisible: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await userEvent.tab();
    const card = cardOf(canvasElement, 'Next hearing');
    await expect(card).toHaveFocus();
    await expect(card.matches(':focus-visible')).toBe(true);
  },
};

/** Keyboard flow: J/K move between cards, E edits, X dismisses, only while the group has focus. */
export const Active: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.keyboard('je');
    await expect(args.onEdit).not.toHaveBeenCalled();
    const first = cardOf(canvasElement, 'Next hearing');
    const second = cardOf(canvasElement, 'Comply with office objections');
    first.focus();
    await userEvent.keyboard('j');
    await expect(second).toHaveFocus();
    await userEvent.keyboard('e');
    await expect(args.onEdit).toHaveBeenLastCalledWith(PROPOSALS[1]);
    await userEvent.keyboard('x');
    await expect(args.onDismiss).toHaveBeenLastCalledWith(PROPOSALS[1]);
    await userEvent.keyboard('{Backspace}');
    await expect(args.onDismiss).toHaveBeenCalledTimes(2);
    await userEvent.keyboard('k');
    await expect(first).toHaveFocus();
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    for (const name of ['Confirm', 'Edit', 'Dismiss']) {
      await expect(
        within(cardOf(canvasElement, 'Next hearing')).getByRole('button', { name }),
      ).toBeDisabled();
    }
  },
};

export const Loading: Story = {
  args: { loading: true },
};

/** Confirm fails: the card comes back with an inline error and focus on the card. */
export const Invalid: Story = {
  args: { onConfirm: fn(() => Promise.reject(new Error('Network unavailable'))) },
  play: async ({ canvasElement, args }) => {
    const card = cardOf(canvasElement, 'Next hearing');
    card.focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onConfirm).toHaveBeenCalledWith(PROPOSALS[0]);
    await expect(await within(card).findByRole('alert')).toHaveTextContent(
      'Could not confirm this change',
    );
    await waitFor(() => expect(card).toHaveFocus());
    await expect(within(card).getByRole('button', { name: 'Confirm' })).toBeEnabled();
  },
};

/** Confirm succeeds: the check draws, the card collapses and the live region announces it. */
export const Confirmed: Story = {
  args: { onConfirm: fn(() => Promise.resolve()) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    cardOf(canvasElement, 'Next hearing').focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Proposal confirmed'));
    await expect(args.onConfirmed).toHaveBeenCalledWith(PROPOSALS[0]);
    await waitFor(() => expect(canvas.queryByRole('group', { name: 'Next hearing' })).toBeNull());
    await expect(canvas.getByRole('list', { name: '2 need you' })).toBeInTheDocument();
    await expect(cardOf(canvasElement, 'Comply with office objections')).toHaveFocus();
  },
};

/** Confirm all safe confirms only the proposals the caller marked safe. */
export const ConfirmAllSafe: Story = {
  args: { onConfirm: fn(() => Promise.resolve()) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm all safe' }));
    await expect(args.onConfirm).toHaveBeenCalledTimes(2);
    await expect(args.onConfirm).not.toHaveBeenCalledWith(PROPOSALS[1]);
    await waitFor(() => expect(canvas.getByRole('list', { name: '1 need you' })).toBeVisible());
    await expect(canvas.queryByRole('button', { name: 'Confirm all safe' })).toBeNull();
  },
};

/** No proposal is marked safe: no bulk action. */
export const NothingSafe: Story = {
  args: { proposals: [PROPOSALS[1] as Proposal<string>] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('button', { name: 'Confirm all safe' }),
    ).toBeNull();
  },
};

/** Values may carry an icon through `renderValue`. */
export const WithIcon: Story = {
  args: {
    renderValue: (value: string) => (
      <span className="inline-flex items-center gap-1">
        <CalendarDays aria-hidden="true" className="size-3.5" />
        {value}
      </span>
    ),
  },
};

export const LongText: Story = {
  args: { proposals: [LONG_PROPOSAL, ...PROPOSALS.slice(0, 1)] },
};

export const RtlNeutral: Story = {
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
};

export const Tamil: Story = {
  args: { proposals: [INDIC_PROPOSALS.tamil] },
  decorators: [
    (Story) => (
      <div lang="ta">
        <Story />
      </div>
    ),
  ],
};

export const Kannada: Story = {
  args: { proposals: [INDIC_PROPOSALS.kannada] },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};

/** Offline: read-only, actions disabled with the reason. */
export const Offline: Story = {
  args: { offline: true },
  play: async ({ canvasElement }) => {
    const card = cardOf(canvasElement, 'Next hearing');
    await expect(within(card).getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await expect(within(card).getByText(/You are offline/)).toBeVisible();
  },
};

/** Permission denied: actions hidden, view-only note. */
export const PermissionDenied: Story = {
  args: { viewOnly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: 'Confirm' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Confirm all safe' })).toBeNull();
    await expect(canvas.getAllByText(/View only/)[0]).toBeVisible();
  },
};

export const Empty: Story = {
  args: { proposals: [] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('heading', { name: 'Nothing needs you right now.' }),
    ).toBeVisible();
  },
};

/** A single card outside a group (no list semantics, no group shortcuts). */
export const SingleCard: Story = {
  render: (args) => (
    <ProposalCard
      proposal={PROPOSALS[0] as Proposal<string>}
      anchor={ANCHORS.madras}
      onConfirm={args.onConfirm}
      onEdit={args.onEdit}
      onDismiss={args.onDismiss}
    />
  ),
};
