// Close-enquiry dialog (#875, #87 part 3): open, closes with a reason, a server error, offline. The
// action is mocked; export names carry `OutcomeDialog`. Nothing is sent to the enquirer.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import type { EnquiryActions } from './enquiry-actions.ts';
import { OutcomeDialog } from './outcome-dialog.tsx';

type CloseAction = EnquiryActions['close'];

const closed = (): ReturnType<CloseAction> =>
  Promise.resolve({ ok: true, data: { id: 'e', status: 'closed' } });

const meta = {
  title: 'People/Enquiries/OutcomeDialog',
  component: OutcomeDialog,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    enquiryId: '00000000-0000-4000-8000-0000000e0001',
    onOpenChange: fn(),
    offline: false,
    close: fn<CloseAction>(closed),
  },
} satisfies Meta<typeof OutcomeDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OutcomeDialogOpen: Story = {
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Close enquiry' })).toBeEnabled();
  },
};

export const OutcomeDialogCloses: Story = {
  play: async ({ args }) => {
    await userEvent.type(await screen.findByLabelText('Reason'), 'Outside practice area');
    await userEvent.click(screen.getByRole('button', { name: 'Close enquiry' }));
    await waitFor(() => expect(args.close).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
  },
};

export const OutcomeDialogError: Story = {
  args: {
    close: fn<CloseAction>(() =>
      Promise.resolve({ ok: false, error: { code: 'FORBIDDEN', message: 'no' } }),
    ),
  },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Close enquiry' }));
    await expect(await screen.findByRole('alert')).toHaveTextContent(
      'You cannot do this in this workspace.',
    );
  },
};

export const OutcomeDialogOffline: Story = {
  args: { offline: true },
  play: async () => {
    await expect(await screen.findByRole('button', { name: 'Close enquiry' })).toBeDisabled();
  },
};

export const OutcomeDialogTamil: Story = {
  globals: { locale: 'ta' },
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
  },
};

export const OutcomeDialogKannada: Story = {
  globals: { locale: 'kn' },
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
  },
};
