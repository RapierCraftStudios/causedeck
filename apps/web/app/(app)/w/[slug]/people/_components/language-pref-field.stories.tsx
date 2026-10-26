// Language preference field (#849, #82 part 3): the native select of the seven languages.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent } from 'storybook/test';

import { LanguagePrefField } from './language-pref-field.tsx';

const meta = {
  title: 'People/LanguagePrefField',
  component: LanguagePrefField,
  args: { value: 'en', onChange: fn() },
} satisfies Meta<typeof LanguagePrefField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const English: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox')).toHaveValue('en');
    await expect(canvas.getAllByRole('option')).toHaveLength(7);
  },
};

export const Choose: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.selectOptions(canvas.getByRole('combobox'), 'ta');
    await expect(args.onChange).toHaveBeenCalledWith('ta');
  },
};

export const Tamil: Story = {
  args: { value: 'ta' },
  globals: { locale: 'ta' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox')).toHaveValue('ta');
  },
};

export const Kannada: Story = {
  args: { value: 'kn' },
  globals: { locale: 'kn' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox')).toHaveValue('kn');
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox')).toBeDisabled();
  },
};
