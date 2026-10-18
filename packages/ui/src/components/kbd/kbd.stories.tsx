// check-stories: n/a Hover, FocusVisible, Active, Disabled, Loading, Invalid, WithIcon (static, non-interactive hint)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { INDIC } from '../__fixtures__/labels';
import { Kbd } from './kbd';

const meta = {
  title: 'Components/Kbd',
  component: Kbd,
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { hotkey: 'mod+k' } };

export const MacModifier: Story = {
  args: { hotkey: 'mod+k', mac: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('⌘K')).toBeInTheDocument();
  },
};

export const OtherPlatformsModifier: Story = {
  args: { hotkey: 'mod+k', mac: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Ctrl+K')).toBeInTheDocument();
  },
};

export const Chord: Story = {
  args: { hotkey: 'g then t', mac: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('G then T')).toBeInTheDocument();
  },
};

export const LongText: Story = {
  args: { children: 'Shift + Enter' },
};

export const RtlNeutral: Story = {
  render: () => (
    <p dir="rtl" className="text-ink text-sm">
      Search <Kbd hotkey="mod+k" mac={false} />
    </p>
  ),
};

export const Tamil: Story = {
  render: () => (
    <p lang="ta" className="text-ink flex items-center gap-2 text-sm">
      <Kbd hotkey="g then t" mac={false} labels={{ then: INDIC.ta.then }} />
    </p>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(`G ${INDIC.ta.then} T`)).toBeInTheDocument();
  },
};

export const Kannada: Story = {
  render: () => (
    <p lang="kn" className="text-ink flex items-center gap-2 text-sm">
      <Kbd hotkey="g then t" mac={false} labels={{ then: INDIC.kn.then }} />
    </p>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(`G ${INDIC.kn.then} T`)).toBeInTheDocument();
  },
};
