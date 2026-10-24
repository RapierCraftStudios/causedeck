// Parse banner (#399): shown only when the newest list was degraded or failed, naming the
// unreadable halls, with the official list (new window) and the share-again link.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { forum } from './__tests__/fixtures.ts';
import { ParseBanner } from './parse-banner.tsx';

const base = forum();
const at = new Date('2026-10-21T04:00:00Z');

const meta = {
  title: 'Courts/ParseBanner',
  component: ParseBanner,
  args: {
    code: base.code,
    slug: 'demo',
    latestParse: { status: 'degraded', at, hallsUnreadable: ['7'] },
    officialList: base.officialList,
  },
} satisfies Meta<typeof ParseBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DegradedOneHall: Story = {
  play: async ({ canvasElement, canvas }) => {
    await expect(canvasElement.querySelector('[data-forum-banner="degraded"]')).not.toBeNull();
    await expect(canvas.getAllByRole('link')).toHaveLength(2);
  },
};

export const DegradedHalls: Story = {
  args: { latestParse: { status: 'degraded', at, hallsUnreadable: ['7', '12A', '14'] } },
};

export const DegradedGeneric: Story = {
  args: { latestParse: { status: 'degraded', at, hallsUnreadable: [] } },
};

export const Failed: Story = {
  args: { latestParse: { status: 'failed', at, hallsUnreadable: [] } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-forum-banner="failed"]')).not.toBeNull();
  },
};

/** No param-free official list: only the share-again link. */
export const NoOfficialList: Story = {
  args: { officialList: null },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('link')).toHaveLength(1);
  },
};

/** An `ok` (or no) parse renders nothing. */
export const Hidden: Story = {
  args: { latestParse: { status: 'ok', at, hallsUnreadable: [] } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-forum-banner]')).toBeNull();
  },
};

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
