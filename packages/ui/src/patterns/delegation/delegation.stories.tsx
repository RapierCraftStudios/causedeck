// check-stories: n/a Hover (rows have no hover-only affordance; the picker and button are native controls)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../states/error-state';
import { OfflineBanner } from '../states/offline-banner';
import { PermissionDenied as PermissionDeniedScreen } from '../states/permission-denied';
import { AssignmentRow, AssignmentRowSkeleton } from './assignment-row';
import { AssigneeChip } from './assignee-chip';
import { OutcomesStrip } from './outcomes-strip';

const MEMBERS = [
  { id: 'm1', name: 'Asha Rao' },
  { id: 'm2', name: 'Vikram Shah' },
];

const meta = {
  title: 'Patterns/Delegation',
  component: AssignmentRow,
  args: {
    title: '12 · Rao v. State',
    detail: 'WP 4410/2026 · Hall 4',
    members: MEMBERS,
    assigneeId: null,
    flag: 'unassigned',
    onAssign: fn(),
  },
  decorators: [
    (Story) => (
      <ul className="max-w-md list-none p-4">
        <Story />
      </ul>
    ),
  ],
} satisfies Meta<typeof AssignmentRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(canvas.getByLabelText('Assignee'), 'm2');
    await userEvent.click(canvas.getByRole('button', { name: 'Assign' }));
    await expect(args.onAssign).toHaveBeenCalledWith('m2');
  },
};

/** `a` on the focused row opens the picker; `Enter` assigns. */
export const KeyboardAssign: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const row = canvasElement.querySelector<HTMLElement>('[data-slot="assignment-row"]');
    row?.focus();
    await userEvent.keyboard('a');
    await expect(canvas.getByLabelText('Assignee')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onAssign).toHaveBeenCalled();
  },
};

export const FocusVisible: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(canvasElement.querySelector('[data-slot="assignment-row"]')).toHaveFocus();
  },
};

export const Clash: Story = {
  args: {
    flag: 'clash',
    assigneeId: 'm1',
    suggestion: { memberId: 'm2', reason: 'Asha is in Hall 4 at the same time.' },
  },
};

export const Offline: Story = {
  args: { sync: 'queued', assigneeId: 'm2', flag: undefined },
  decorators: [
    (Story) => (
      <>
        <OfflineBanner savedAt={new Date('2026-10-25T10:42:00+05:30')} />
        <Story />
      </>
    ),
  ],
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Will sync')).toBeVisible();
  },
};

export const Disabled: Story = { args: { disabled: true } };

export const Loading: Story = {
  render: () => <AssignmentRowSkeleton />,
};

export const Empty: Story = {
  render: () => <EmptyState title="No appearances to assign for tomorrow" />,
};

export const ErrorStory: Story = {
  name: 'Error',
  render: () => <ErrorState title="Could not load the plan." onRetry={fn()} />,
};

export const Denied: Story = {
  render: () => <PermissionDeniedScreen />,
};

export const Chip: Story = {
  render: () => (
    <div className="flex gap-2">
      <AssigneeChip name="Asha Rao" />
      <AssigneeChip />
    </div>
  ),
};

export const Outcomes: Story = {
  render: () => (
    <OutcomesStrip members={[{ memberId: 'm1', name: 'Asha Rao', total: 5, outcomesIn: 2 }]} />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('2 of 5');
  },
};

/** Pressing Assign commits the chosen member. */
export const Active: Story = {
  args: { suggestion: { memberId: 'm2', reason: 'Vikram is free all morning.' } },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Assign' }));
    await expect(args.onAssign).toHaveBeenCalledWith('m2');
  },
};

/** The plan could not be saved: what happened, Try again and support, in place of the rows. */
export const Invalid: Story = {
  render: () => (
    <ErrorState
      title="Could not save the assignment."
      description="Your choice is kept on this device and will sync when the connection returns."
      onRetry={fn()}
      supportHref="mailto:support@lawyer-os.in"
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};

/** Status cues: unassigned, clash and queued each carry an icon with their label. */
export const WithIcon: Story = {
  render: (args) => (
    <ul className="flex list-none flex-col gap-2 p-0">
      <AssignmentRow {...args} flag="unassigned" />
      <AssignmentRow {...args} flag="clash" assigneeId="m1" />
      <AssignmentRow {...args} flag={undefined} assigneeId="m2" sync="queued" />
    </ul>
  ),
};

export const LongText: Story = {
  args: {
    title: '112 · Hon’ble Division Bench Writ Appeals and connected matters v. State of Karnataka',
    detail: 'WA 1204/2026 and 31 connected appeals · Court Hall 12, Main Building, first floor',
    members: [{ id: 'm1', name: 'Venkatasubramanian Ramachandran-Iyer Associates' }, ...MEMBERS],
  },
  decorators: [
    (Story) => (
      <div className="max-w-80">
        <Story />
      </div>
    ),
  ],
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
  args: {
    title: '12 · ராவ் எதிர் மாநிலம்',
    detail: 'நீதிமன்ற அறை 4',
    members: [
      { id: 'm1', name: 'ஆஷா ராவ்' },
      { id: 'm2', name: 'விக்ரம் ஷா' },
    ],
    labels: {
      assignee: 'ஒதுக்கீடு பெறுபவர்',
      assign: 'ஒதுக்கு',
      choose: 'உறுப்பினரைத் தேர்ந்தெடுக்கவும்',
      unassigned: 'ஒதுக்கப்படவில்லை',
    },
  },
};

export const Kannada: Story = {
  args: {
    title: '12 · ರಾವ್ ವಿರುದ್ಧ ರಾಜ್ಯ',
    detail: 'ನ್ಯಾಯಾಲಯ ಸಭಾಂಗಣ 4',
    members: [
      { id: 'm1', name: 'ಆಶಾ ರಾವ್' },
      { id: 'm2', name: 'ವಿಕ್ರಮ್ ಶಾ' },
    ],
    labels: {
      assignee: 'ನಿಯೋಜಿತರು',
      assign: 'ನಿಯೋಜಿಸಿ',
      choose: 'ಸದಸ್ಯರನ್ನು ಆರಿಸಿ',
      unassigned: 'ನಿಯೋಜಿಸಿಲ್ಲ',
    },
  },
};
