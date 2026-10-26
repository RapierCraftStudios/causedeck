// check-stories: n/a Hover, Disabled, Invalid, WithIcon, RtlNeutral (a read-only note: no hover-only affordance, disabled or invalid input, icon or direction-specific layout)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../states/error-state';
import { OfflineBanner } from '../states/offline-banner';
import { PermissionDenied as PermissionDeniedScreen } from '../states/permission-denied';
import { ChangeCard } from './change-card';
import { HandoverSkeleton, HandoverView, type HandoverSectionView } from './handover-view';

const SECTIONS: HandoverSectionView[] = [
  {
    id: 'stage',
    title: 'Where it stands',
    items: [{ id: 's1', text: 'FOR FINAL HEARING', detail: 'Listing, 26 Oct' }],
    emptyLabel: 'None recorded',
  },
  {
    id: 'order',
    title: 'Last orders',
    items: [
      {
        id: 'o1',
        text: 'Respondent shall file the counter affidavit by 20 October 2026.',
        detail: 'p. 1',
      },
      {
        id: 'o2',
        text: 'Petitioner may file a rejoinder within one week.',
        detail: 'p. 1',
        flag: 'Unconfirmed',
      },
    ],
    emptyLabel: 'None recorded',
  },
  {
    id: 'obligations',
    title: 'Open obligations',
    items: [{ id: 'b1', text: 'counter not yet filed; due 20 Oct', flag: 'Overdue' }],
    emptyLabel: 'None recorded',
  },
  { id: 'questions', title: 'Open questions', items: [], emptyLabel: 'None recorded' },
];

const meta = {
  title: 'Patterns/Continuity',
  component: HandoverView,
  args: {
    title: 'Handover: Asha Traders v. State of Fictionia',
    byline: 'Version 2 · from Asha to Vikram · 26 Oct',
    sections: SECTIONS,
    acknowledge: {
      label: 'Acknowledge',
      doneLabel: 'Acknowledged',
      done: false,
      onAcknowledge: fn(),
    },
  },
} satisfies Meta<typeof HandoverView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Where it stands')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: /share|export|email/i })).toBeNull();
  },
};

export const FocusVisible: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByRole('button', { name: 'Acknowledge' })).toHaveFocus();
  },
};

/** Pressing Acknowledge calls back once; the keyboard does the same. */
export const Active: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    await expect(args.acknowledge?.onAcknowledge).toHaveBeenCalled();
    await expect(within(canvasElement).getByText('Open questions')).toBeVisible();
  },
};

export const Acknowledged: Story = {
  args: {
    acknowledge: {
      label: 'Acknowledge',
      doneLabel: 'Acknowledged',
      done: true,
      onAcknowledge: fn(),
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Acknowledged');
  },
};

export const LongText: Story = {
  args: {
    sections: [
      {
        id: 'stage',
        title: 'Where it stands',
        items: [{ id: 's1', text: 'Respondent '.repeat(60), detail: 'Listing, 26 Oct' }],
        emptyLabel: 'None recorded',
      },
    ],
  },
};

export const Tamil: Story = {
  args: {
    title: 'ஒப்படைப்பு குறிப்பு',
    sections: [{ ...SECTIONS[3]!, title: 'திறந்த கேள்விகள்', emptyLabel: 'பதிவு இல்லை' }],
  },
};

export const Kannada: Story = {
  args: {
    title: 'ಹಸ್ತಾಂತರ ಟಿಪ್ಪಣಿ',
    sections: [{ ...SECTIONS[3]!, title: 'ಬಾಕಿ ಪ್ರಶ್ನೆಗಳು', emptyLabel: 'ಯಾವುದೂ ದಾಖಲಾಗಿಲ್ಲ' }],
  },
};

export const Loading: Story = { render: () => <HandoverSkeleton /> };

export const Empty: Story = {
  render: () => <EmptyState title="No handover yet" />,
};

export const ErrorStory: Story = {
  name: 'Error',
  render: () => <ErrorState title="Could not load the handover." onRetry={fn()} />,
};

export const Offline: Story = {
  render: (args) => (
    <>
      <OfflineBanner savedAt={new Date('2026-10-25T10:42:00+05:30')} />
      <HandoverView {...args} acknowledge={undefined} />
    </>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Where it stands')).toBeVisible();
  },
};

export const Denied: Story = { render: () => <PermissionDeniedScreen /> };

export const WhatChanged: Story = {
  render: () => (
    <ChangeCard
      heading="Since you last opened this, 12 days ago"
      groups={[
        { day: '20 Oct', items: [{ id: '1', text: 'New order of 20 Oct', detail: 'Order, p. 1' }] },
        {
          day: '24 Oct',
          items: [
            { id: '2', text: 'Obligation created: rejoinder to be filed', detail: 'by Asha' },
          ],
        },
      ]}
      emptyLabel="Nothing changed"
      dismissLabel="Dismiss"
      onDismiss={fn()}
    />
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Dismiss' }));
  },
};
