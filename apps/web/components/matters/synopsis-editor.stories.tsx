// Synopsis card (#390): the lawyer's own note, with empty, editing, offline and permission-denied
// states. Clerks never see the content.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent } from 'storybook/test';

import { SynopsisEditor } from './synopsis-editor.tsx';

const meta = {
  title: 'Matters/SynopsisEditor',
  component: SynopsisEditor,
  args: {
    workspaceId: '00000000-0000-4000-8000-00000000a001',
    matterId: '00000000-0000-4000-8000-0000000a1001',
    synopsis: 'Writ against the Housing Board for the allotment order dated 4 March 2025.',
    denied: false,
    canWrite: true,
    action: fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { id: '00000000-0000-4000-8000-0000000a1001', title: 'Matter', synopsis: 'Saved' },
      }),
    ),
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SynopsisEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSynopsis: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Edit synopsis' })).toBeVisible();
  },
};

export const Empty: Story = {
  args: { synopsis: null },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Write synopsis' })).toBeVisible();
  },
};

export const Editing: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Edit synopsis' }));
    await expect(canvas.getByRole('textbox', { name: 'Synopsis' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Save synopsis' })).toBeVisible();
  },
};

export const Failed: Story = {
  args: {
    action: fn(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'INTERNAL' as const, message: '' },
      }),
    ),
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Edit synopsis' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Save synopsis' }));
    await expect(await canvas.findByText("Couldn't save the synopsis. Try again.")).toBeVisible();
  },
};

export const Offline: Story = {
  args: { offline: true },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Edit synopsis' }));
    await expect(canvas.getByRole('button', { name: 'Save synopsis' })).toBeDisabled();
  },
};

export const ReadOnly: Story = {
  args: { canWrite: false },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Edit synopsis' })).toBeNull();
  },
};

export const PermissionDenied: Story = {
  args: { denied: true },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("Your role can't see the synopsis. Ask the chamber owner."),
    ).toBeVisible();
  },
};

export const Tamil: Story = {
  args: { synopsis: 'இளங்கோ எதிர் கற்பனை வீட்டு வசதி வாரியம்: ஒதுக்கீட்டு உத்தரவை எதிர்த்து மனு.' },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: { synopsis: 'ಇಳಂಗೋ ವಿರುದ್ಧ ಕಾಲ್ಪನಿಕ ವಸತಿ ಮಂಡಳಿ: ಹಂಚಿಕೆ ಆದೇಶದ ವಿರುದ್ಧ ರಿಟ್.' },
  globals: { locale: 'kn' },
};
