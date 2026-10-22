// Proceeding row (#392): case number, state badge, forum, identifiers, next date and links, with
// Edit and the state menu for writers and a checkbox in split mode.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import type { ProceedingRowView } from '../../lib/matters/proceedings-view.ts';

import { ProceedingRow } from './proceeding-row.tsx';

const row = (overrides: Partial<ProceedingRowView> = {}): ProceedingRowView => ({
  id: '00000000-0000-4000-8000-0000000c1001',
  depth: 1,
  kind: 'main',
  state: 'numbered',
  caseType: 'WP',
  caseNumber: { type: 'WP', number: '1234', year: 2025 },
  label: 'WP 1234/2025',
  unnumbered: false,
  forum: 'High Court of Madras, Chennai',
  forumId: '00000000-0000-4000-8000-0000000f0001',
  srNo: null,
  frNo: null,
  diaryNo: null,
  filingNo: null,
  cnr: 'MDHC010012342025',
  stage: 'For hearing',
  nextDate: { text: '14 Mar 2026', relative: 'in 2 days' },
  links: [],
  transitions: ['disposed'],
  children: [],
  ...overrides,
});

const meta = {
  title: 'Matters/ProceedingRow',
  component: ProceedingRow,
  args: {
    row: row(),
    workspaceId: '00000000-0000-4000-8000-00000000a001',
    slug: 'chennai-solo',
    active: true,
    offline: false,
    canWrite: true,
    transition: fn(() => Promise.resolve({ ok: true as const, data: null })),
    onEdit: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProceedingRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Numbered: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-proceeding-row]')).not.toBeNull();
  },
};

export const Unnumbered: Story = {
  args: {
    row: row({
      state: 'sr_fr',
      caseNumber: null,
      unnumbered: true,
      srNo: '5678',
      cnr: null,
      nextDate: null,
      stage: null,
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-unnumbered]')).not.toBeNull();
  },
};

export const Defects: Story = {
  args: { row: row({ state: 'defects', transitions: ['re_presented'] }) },
};

export const WithAppealLink: Story = {
  args: {
    row: row({
      kind: 'appeal',
      caseType: 'WA',
      caseNumber: { type: 'WA', number: '88', year: 2026 },
      label: 'WA 88/2026',
      links: [
        {
          linkId: '00000000-0000-4000-8000-0000000d1001',
          kind: 'appeal_from',
          direction: 'from',
          otherLabel: 'WP 1234/2025',
          otherMatterId: null,
        },
      ],
    }),
  },
};

export const WithChildren: Story = {
  args: {
    row: row({
      children: [row({ id: '00000000-0000-4000-8000-0000000c1002', depth: 2, kind: 'misc' })],
    }),
    expanded: true,
    onToggle: fn(),
  },
};

export const SplitSelected: Story = {
  args: { selecting: true, selected: true, onSelectedChange: fn() },
};

export const ReadOnly: Story = {
  args: { canWrite: false, row: row({ transitions: [] }) },
};

export const Offline: Story = {
  args: { offline: true },
};

export const Tamil: Story = {
  args: {
    row: row({
      forum: 'சென்னை உயர் நீதிமன்றம், சென்னை',
      links: [
        {
          linkId: '00000000-0000-4000-8000-0000000d1002',
          kind: 'connected',
          direction: 'to',
          otherLabel: 'WMP 4021/2025',
          otherMatterId: null,
        },
      ],
    }),
  },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: {
    row: row({
      forum: 'ಕರ್ನಾಟಕ ಉಚ್ಚ ನ್ಯಾಯಾಲಯ, ಬೆಂಗಳೂರು',
      links: [
        {
          linkId: '00000000-0000-4000-8000-0000000d1003',
          kind: 'connected',
          direction: 'to',
          otherLabel: 'WMP 4021/2025',
          otherMatterId: null,
        },
      ],
    }),
  },
  globals: { locale: 'kn' },
};
