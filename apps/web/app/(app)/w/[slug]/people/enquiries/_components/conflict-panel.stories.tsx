// Conflict panel (#875, #87 part 3): not run, running, no hits, hits with the warning, an error,
// disabled (offline) and the proceed/decline/refer decisions with a note. Export names carry
// `ConflictPanel`; the panel shows hits and never a verdict.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent } from 'storybook/test';

import type { ConflictCheckView } from '../../../../../../../lib/intake/intake-deps.ts';
import { ConflictPanel } from './conflict-panel.tsx';

const hit = (matterTitle: string, reason: string): ConflictCheckView['hits'][number] => ({
  checked: 'Fictional Trading Co',
  side: 'adverse',
  matterId: '00000000-0000-4000-8000-0000000a0001',
  matterTitle,
  matchedName: 'Fictional Trading Company',
  existingRole: 'client',
  score: 0.92,
  reason,
});

const withHits = (hits: ConflictCheckView['hits']): ConflictCheckView => ({
  checkedAt: '2026-10-20T09:00:00.000Z',
  partyCount: 2,
  hits,
});

const meta = {
  title: 'People/Enquiries/ConflictPanel',
  component: ConflictPanel,
  args: {
    result: withHits([hit('Fictional Trading Co v. Example Estates', 'Similar name.')]),
    running: false,
    disabled: false,
    error: null,
    onDecide: fn(),
  },
} satisfies Meta<typeof ConflictPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConflictPanelNotRun: Story = {
  args: { result: null },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('The conflict check has not been run.')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Proceed' })).toBeNull();
  },
};

export const ConflictPanelRunning: Story = {
  args: { result: null, running: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Checking your matters');
  },
};

export const ConflictPanelNoHits: Story = {
  args: { result: withHits([]) },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('No matches found');
    await expect(canvas.getByText(/This is not a clearance/)).toBeVisible();
  },
};

export const ConflictPanelHits: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Possible conflict. Review before you proceed.')).toBeVisible();
    await expect(canvas.getByRole('status')).toHaveTextContent('1 match found');
    await expect(canvas.getByRole('list', { name: 'Possible conflicts' })).toBeVisible();
  },
};

export const ConflictPanelError: Story = {
  args: { error: 'Could not save. Try again.' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('Could not save. Try again.');
  },
};

export const ConflictPanelDisabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    for (const name of ['Proceed', 'Decline', 'Refer']) {
      await expect(canvas.getByRole('button', { name })).toBeDisabled();
    }
  },
};

export const ConflictPanelDecide: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.type(canvas.getByLabelText('Decision note'), ' Refer to Meera ');
    await userEvent.click(canvas.getByRole('button', { name: 'Refer' }));
    await expect(args.onDecide).toHaveBeenCalledWith('refer', 'Refer to Meera');
    await userEvent.click(canvas.getByRole('button', { name: 'Proceed' }));
    await expect(args.onDecide).toHaveBeenLastCalledWith('proceed', 'Refer to Meera');
    await userEvent.click(canvas.getByRole('button', { name: 'Decline' }));
    await expect(args.onDecide).toHaveBeenLastCalledWith('decline', 'Refer to Meera');
  },
};

export const ConflictPanelTamil: Story = {
  args: { result: withHits([hit('முருகன் எதிர் இளங்கோ', 'ஒத்த பெயர்.')]) },
  globals: { locale: 'ta' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('முருகன் எதிர் இளங்கோ')).toBeVisible();
  },
};

export const ConflictPanelKannada: Story = {
  args: { result: withHits([hit('ಕಾವೇರಿ ವಿರುದ್ಧ ಗೌಡ', 'ಒಂದೇ ರೀತಿಯ ಹೆಸರು.')]) },
  globals: { locale: 'kn' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('ಕಾವೇರಿ ವಿರುದ್ಧ ಗೌಡ')).toBeVisible();
  },
};
