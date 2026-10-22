// Deep links (#400): new-window links to the forum's official pages that need no case details,
// with a captcha notice where the court's page asks for one.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { forumDetail } from './__tests__/fixtures.ts';
import { DeepLinkList } from './deep-link-list.tsx';

const meta = {
  title: 'Courts/DeepLinkList',
  component: DeepLinkList,
  args: { links: forumDetail().deepLinks },
} satisfies Meta<typeof DeepLinkList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, canvasElement }) => {
    for (const link of canvas.getAllByRole('link')) {
      await expect(link).toHaveAttribute('target', '_blank');
    }
    await expect(canvasElement.querySelectorAll('[data-captcha-notice]')).toHaveLength(1);
  },
};

export const NoCaptcha: Story = {
  args: { links: forumDetail().deepLinks.filter((link) => !link.captchaGated) },
};

export const Empty: Story = {
  args: { links: [] },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-deep-links-empty]')).not.toBeNull();
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getAllByRole('link')[0]).toHaveFocus();
  },
};

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
