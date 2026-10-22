// Forum card (#399): name, place, languages, adapter level and the newest parse's status, with the
// parse banner when that list was degraded or failed.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { forum } from './__tests__/fixtures.ts';
import { ForumCard } from './forum-card.tsx';

const at = new Date('2026-10-21T04:00:00Z');

const meta = {
  title: 'Courts/ForumCard',
  component: ForumCard,
  args: { forum: forum(), slug: 'demo' },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ForumCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const A1: Story = {
  args: { forum: forum({ latestParse: { status: 'ok', at, hallsUnreadable: [] } }) },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('link')[0]).toHaveAttribute(
      'href',
      '/w/demo/courts/in.tn.madras-hc.principal.appellate',
    );
  },
};

export const A0: Story = {
  args: {
    forum: forum({
      code: 'in.ka.bengaluru.city-civil',
      court: 'City Civil Court',
      establishment: null,
      seat: 'Bengaluru',
      side: 'not_applicable',
      adapterId: null,
      adapterLevel: 'A0',
      languageProfile: { primary: 'en', secondary: ['kn'] },
    }),
  },
};

export const NoParse: Story = {};

export const Degraded: Story = {
  args: {
    forum: forum({ latestParse: { status: 'degraded', at, hallsUnreadable: ['7', '12A'] } }),
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-forum-banner="degraded"]')).not.toBeNull();
  },
};

export const Failed: Story = {
  args: { forum: forum({ latestParse: { status: 'failed', at, hallsUnreadable: [] } }) },
};

export const WorkspaceOwned: Story = {
  args: {
    forum: forum({
      code: 'ws.chennai.family-court',
      court: 'Family Court',
      establishment: null,
      seat: 'Chennai',
      side: 'not_applicable',
      adapterId: null,
      adapterLevel: 'A0',
      workspaceOwned: true,
      officialList: null,
    }),
  },
};

export const FocusVisible: Story = {
  args: { tabIndex: 0 },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getAllByRole('link')[0]).toHaveFocus();
  },
};

export const LongText: Story = {
  args: {
    forum: forum({
      court:
        'Principal District and Sessions Court and Additional Special Court for NDPS Act Cases',
      establishment: 'Combined Court Complex, Fourth Additional Bench (Commercial Division)',
    }),
  },
};

export const Tamil: Story = {
  args: { forum: forum({ court: 'சென்னை உயர் நீதிமன்றம்', establishment: 'முதன்மை அமர்வு' }) },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: {
    forum: forum({
      court: 'ಕರ್ನಾಟಕ ಉಚ್ಚ ನ್ಯಾಯಾಲಯ',
      establishment: 'ಪ್ರಧಾನ ಪೀಠ',
      adapterLevel: 'A0',
    }),
  },
  globals: { locale: 'kn' },
};
