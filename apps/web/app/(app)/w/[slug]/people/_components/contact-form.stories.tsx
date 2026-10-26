// New-contact dialog (#849, #82 part 3): validation, success, the three server errors, a thrown
// action, offline, and Tamil/Kannada client names. The action is mocked.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import type { Result } from '../../../../../../lib/safe-action.ts';
import { ContactForm } from './contact-form.tsx';

type CreateAction = (input: unknown) => Promise<Result<{ id: string; personId: string }>>;

const created = (): Promise<Result<{ id: string; personId: string }>> =>
  Promise.resolve({ ok: true, data: { id: 'c', personId: 'p' } });

const failing =
  (code: 'FORBIDDEN' | 'VALIDATION'): CreateAction =>
  () =>
    Promise.resolve({ ok: false, error: { code, message: code } });

const meta = {
  title: 'People/ContactForm',
  component: ContactForm,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    open: true,
    onOpenChange: fn(),
    createAction: fn<CreateAction>(created),
  },
} satisfies Meta<typeof ContactForm>;

export default meta;
type Story = StoryObj<typeof meta>;

const fill = async (name: string, email: string) => {
  await userEvent.type(screen.getByLabelText(/Client name/), name);
  await userEvent.type(screen.getByLabelText('Email'), email);
};

export const Empty: Story = {
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Save contact' })).toBeEnabled();
  },
};

export const NameRequired: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Save contact' }));
    await expect(await screen.findByRole('alert')).toHaveTextContent(
      'The client this contact belongs to.',
    );
  },
};

export const NeedsPhoneOrEmail: Story = {
  play: async () => {
    await userEvent.type(await screen.findByLabelText(/Client name/), 'Ilango Murugesan');
    await userEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    await expect(await screen.findByRole('alert')).toHaveTextContent('Give a phone or an email.');
  },
};

export const Saves: Story = {
  play: async ({ args }) => {
    await screen.findByRole('dialog');
    await fill('Ilango Murugesan', 'ilango@example.e2e.test');
    await userEvent.selectOptions(screen.getByLabelText('Language for messages'), 'ta');
    await userEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    await waitFor(() => expect(args.createAction).toHaveBeenCalledTimes(1));
    await expect(args.createAction).toHaveBeenCalledWith(
      expect.objectContaining({
        clientName: 'Ilango Murugesan',
        email: 'ilango@example.e2e.test',
        languagePref: 'ta',
      }),
    );
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
  },
};

export const Forbidden: Story = {
  args: { createAction: fn<CreateAction>(failing('FORBIDDEN')) },
  play: async () => {
    await screen.findByRole('dialog');
    await fill('Ilango Murugesan', 'ilango@example.e2e.test');
    await userEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    await expect(await screen.findByRole('alert')).toHaveTextContent(
      'You cannot change client contacts.',
    );
  },
};

export const Invalid: Story = {
  args: { createAction: fn<CreateAction>(failing('VALIDATION')) },
  play: async () => {
    await screen.findByRole('dialog');
    await fill('Ilango Murugesan', 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    await expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check the phone (with country code) and email.',
    );
  },
};

export const Failed: Story = {
  args: { createAction: fn<CreateAction>(() => Promise.reject(new Error('boom'))) },
  play: async () => {
    await screen.findByRole('dialog');
    await fill('Ilango Murugesan', 'ilango@example.e2e.test');
    await userEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    await expect(await screen.findByRole('alert')).toHaveTextContent(
      'The contact could not be saved. Try again.',
    );
  },
};

/** Offline: the notice shows and saving is disabled. */
export const Offline: Story = {
  args: { offline: true },
  play: async () => {
    await expect(await screen.findByRole('status')).toHaveTextContent('You are offline.');
    await expect(screen.getByRole('button', { name: 'Save contact' })).toBeDisabled();
  },
};

export const Tamil: Story = {
  globals: { locale: 'ta' },
  play: async () => {
    const input = await screen.findByRole('textbox', { name: /Client name|வாடிக்கையாளர்/ });
    await userEvent.type(input, 'முருகன் இளங்கோவன்');
    await expect(input).toHaveValue('முருகன் இளங்கோவன்');
  },
};

export const Kannada: Story = {
  globals: { locale: 'kn' },
  play: async () => {
    const input = await screen.findByRole('textbox', { name: /Client name|ಕ್ಲೈಂಟ್|ಗ್ರಾಹಕ/ });
    await userEvent.type(input, 'ಕಾವೇರಿ ಗೌಡ');
    await expect(input).toHaveValue('ಕಾವೇರಿ ಗೌಡ');
  },
};
