// Forum header (#400): place, languages, adapter level, the newest parse's status and the parse
// banner on a forum's own pages.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { forum, forumRow } from './__tests__/fixtures.ts';
import { ForumHeader } from './forum-header.tsx';

const at = new Date('2026-10-21T04:00:00Z');
const officialList = forum().officialList;

const meta = {
  title: 'Courts/ForumHeader',
  component: ForumHeader,
  args: {
    forum: forumRow(),
    slug: 'demo',
    latestParse: { status: 'ok', at, hallsUnreadable: [] },
    officialList,
  },
} satisfies Meta<typeof ForumHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const A1: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-adapter-level="A1"]')).not.toBeNull();
    await expect(canvasElement.querySelector('[data-forum-banner]')).toBeNull();
  },
};

export const A0: Story = {
  args: {
    forum: forumRow({
      code: 'in.ka.bengaluru.city-civil',
      court: 'City Civil Court',
      establishment: null,
      seat: 'Bengaluru',
      side: 'not_applicable',
      adapterId: null,
      adapterLevel: 'A0',
      languageProfile: { primary: 'en', secondary: ['kn'] },
    }),
    latestParse: null,
  },
};

export const Degraded: Story = {
  args: { latestParse: { status: 'degraded', at, hallsUnreadable: ['7'] } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-forum-banner="degraded"]')).not.toBeNull();
  },
};

export const Failed: Story = {
  args: { latestParse: { status: 'failed', at, hallsUnreadable: [] }, officialList: null },
};

export const WorkspaceOwned: Story = {
  args: {
    forum: forumRow({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      code: 'ws.chennai.family-court',
      court: 'Family Court',
      establishment: null,
      side: 'not_applicable',
      adapterId: null,
      adapterLevel: 'A0',
      languageProfile: { primary: 'ta', secondary: ['en'] },
    }),
    latestParse: null,
    officialList: null,
  },
};

export const LongText: Story = {
  args: {
    forum: forumRow({
      establishment: 'Combined Court Complex, Fourth Additional Bench (Commercial Division)',
      languageProfile: { primary: 'en', secondary: ['ta', 'kn', 'hi'] },
    }),
  },
};

export const Tamil: Story = {
  args: { forum: forumRow({ establishment: 'முதன்மை அமர்வு', seat: 'சென்னை' }) },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: { forum: forumRow({ establishment: 'ಪ್ರಧಾನ ಪೀಠ', seat: 'ಬೆಂಗಳೂರು', adapterLevel: 'A0' }) },
  globals: { locale: 'kn' },
};
