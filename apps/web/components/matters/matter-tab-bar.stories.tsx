// Matter tab bar (#390): `role="tablist"` links with a roving tabindex; Left/Right wrap, Home and
// End jump. The active tab is the longest href the (mocked) pathname starts with.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { MatterTabs } from './matter-tab-bar.tsx';

const BASE = '/w/demo/matters/00000000-0000-4000-8000-000000000001';

const meta = {
  title: 'Matters/MatterTabs',
  component: MatterTabs,
  args: {
    label: 'Matter sections',
    entries: [
      { id: 'overview', href: BASE, label: 'Overview' },
      { id: 'proceedings', href: `${BASE}/proceedings`, label: 'Proceedings' },
      { id: 'people', href: `${BASE}/people`, label: 'People' },
      { id: 'documents', href: `${BASE}/documents`, label: 'Documents' },
    ],
    children: <p>Tab content</p>,
  },
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: BASE } } },
} satisfies Meta<typeof MatterTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('tablist', { name: 'Matter sections' })).toBeVisible();
    await expect(canvas.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(canvas.getByRole('tabpanel')).toBeVisible();
  },
};

export const Proceedings: Story = {
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: `${BASE}/proceedings` } } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('tab', { name: 'Proceedings' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  },
};

export const ArrowKeys: Story = {
  play: async ({ canvas, userEvent }) => {
    canvas.getByRole('tab', { name: 'Overview' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(canvas.getByRole('tab', { name: 'Documents' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    await expect(canvas.getByRole('tab', { name: 'Overview' })).toHaveFocus();
  },
};

export const Tamil: Story = {
  args: {
    label: 'விவகாரப் பிரிவுகள்',
    entries: [
      { id: 'overview', href: BASE, label: 'மேலோட்டம்' },
      { id: 'proceedings', href: `${BASE}/proceedings`, label: 'வழக்கு நடவடிக்கைகள்' },
      { id: 'people', href: `${BASE}/people`, label: 'நபர்கள்' },
      { id: 'documents', href: `${BASE}/documents`, label: 'ஆவணங்கள்' },
    ],
  },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: {
    label: 'ವಿಷಯದ ವಿಭಾಗಗಳು',
    entries: [
      { id: 'overview', href: BASE, label: 'ಅವಲೋಕನ' },
      { id: 'proceedings', href: `${BASE}/proceedings`, label: 'ಪ್ರಕ್ರಿಯೆಗಳು' },
      { id: 'people', href: `${BASE}/people`, label: 'ವ್ಯಕ್ತಿಗಳು' },
      { id: 'documents', href: `${BASE}/documents`, label: 'ದಾಖಲೆಗಳು' },
    ],
  },
  globals: { locale: 'kn' },
};
