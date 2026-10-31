// New-enquiry dialog (#875, #87 part 3): open, validation, success, a server error, a thrown action,
// offline and Tamil/Kannada names. The action is mocked; export names carry `EnquiryForm`.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import type { Result } from '../../../../../../../lib/safe-action.ts';
import type { EnquiryActions } from './enquiry-actions.ts';
import { EnquiryForm } from './enquiry-form.tsx';

type LogAction = EnquiryActions['log'];

const logged = (): ReturnType<LogAction> =>
  Promise.resolve({ ok: true, data: { id: 'e', status: 'logged' } });

const failing =
  (code: 'FORBIDDEN' | 'VALIDATION'): LogAction =>
  (): Promise<Result<{ id: string; status: string }>> =>
    Promise.resolve({ ok: false, error: { code, message: code } });

const meta = {
  title: 'People/Enquiries/EnquiryForm',
  component: EnquiryForm,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    open: true,
    onOpenChange: fn(),
    offline: false,
    log: fn<LogAction>(logged),
  },
} satisfies Meta<typeof EnquiryForm>;

export default meta;
type Story = StoryObj<typeof meta>;

const fill = async (name: string, summary: string) => {
  await userEvent.type(screen.getByLabelText(/Enquirer/), name);
  await userEvent.type(screen.getByLabelText(/Summary/), summary);
};

export const EnquiryFormOpen: Story = {
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Save enquiry' })).toBeEnabled();
  },
};

export const EnquiryFormRequired: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Save enquiry' }));
    await expect(await screen.findByRole('alert')).toHaveTextContent(
      "Add the enquirer's name and a summary.",
    );
  },
};

export const EnquiryFormSaves: Story = {
  play: async ({ args }) => {
    await screen.findByRole('dialog');
    await fill('Asha Raman', 'Lease dispute');
    await userEvent.click(screen.getByRole('button', { name: 'Save enquiry' }));
    await waitFor(() => expect(args.log).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
  },
};

export const EnquiryFormForbidden: Story = {
  args: { log: fn<LogAction>(failing('FORBIDDEN')) },
  play: async () => {
    await screen.findByRole('dialog');
    await fill('Asha Raman', 'Lease dispute');
    await userEvent.click(screen.getByRole('button', { name: 'Save enquiry' }));
    await expect(await screen.findByRole('alert')).toHaveTextContent(
      'You cannot do this in this workspace.',
    );
  },
};

export const EnquiryFormThrows: Story = {
  args: { log: fn<LogAction>(() => Promise.reject(new Error('network'))) },
  play: async () => {
    await screen.findByRole('dialog');
    await fill('Asha Raman', 'Lease dispute');
    await userEvent.click(screen.getByRole('button', { name: 'Save enquiry' }));
    await expect(await screen.findByRole('alert')).toHaveTextContent('Could not save. Try again.');
  },
};

export const EnquiryFormOffline: Story = {
  args: { offline: true },
  play: async () => {
    await expect(await screen.findByRole('button', { name: 'Save enquiry' })).toBeDisabled();
    await expect(screen.getByRole('status')).toHaveTextContent('You are offline');
  },
};

const enquirerField = (): HTMLElement => {
  const field = document.querySelector<HTMLElement>('[data-enquiry-field="enquirer"]');
  if (field === null) throw new Error('enquirer field missing');
  return field;
};

export const EnquiryFormTamil: Story = {
  globals: { locale: 'ta' },
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
    await userEvent.type(enquirerField(), 'முருகன் இளங்கோவன்');
    await expect(screen.getByDisplayValue('முருகன் இளங்கோவன்')).toBeVisible();
  },
};

export const EnquiryFormKannada: Story = {
  globals: { locale: 'kn' },
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
    await userEvent.type(enquirerField(), 'ಕಾವೇರಿ ಗೌಡ');
    await expect(screen.getByDisplayValue('ಕಾವೇರಿ ಗೌಡ')).toBeVisible();
  },
};
