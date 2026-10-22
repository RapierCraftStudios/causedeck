// Proceeding form (#392): add or edit a proceeding with the forum's case types, identifiers and
// links; warns about a duplicate in this or another matter before saving.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen } from 'storybook/test';

import type { ForumOption, ProceedingRowView } from '../../lib/matters/proceedings-view.ts';

import { ProceedingForm, type ProceedingFormActions } from './proceeding-form.tsx';

const ok = () => Promise.resolve({ ok: true as const, data: null });

const actions: ProceedingFormActions = {
  create: fn(() =>
    Promise.resolve({
      ok: true as const,
      data: { id: '00000000-0000-4000-8000-0000000c1009' },
    }),
  ),
  update: fn(() =>
    Promise.resolve({
      ok: true as const,
      data: { id: '00000000-0000-4000-8000-0000000c1001' },
    }),
  ),
  link: fn(ok),
  findDuplicates: fn(() => Promise.resolve({ ok: true as const, data: [] })),
};

const FORUMS: ForumOption[] = [
  {
    id: '00000000-0000-4000-8000-0000000f0001',
    name: 'High Court of Madras, Chennai',
    code: 'in.tn.madras-hc.principal.appellate',
    caseTypes: [
      { code: 'WP', label: 'WP', aliases: ['Writ Petition'] },
      { code: 'WA', label: 'WA', aliases: ['Writ Appeal'] },
    ],
  },
  {
    id: '00000000-0000-4000-8000-0000000f0002',
    name: 'Family Court, Chennai',
    code: 'ws.chennai.family-court',
    caseTypes: [],
  },
];

const editing: ProceedingRowView = {
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
  diaryNo: '9001',
  filingNo: null,
  cnr: 'MDHC010012342025',
  stage: null,
  nextDate: null,
  links: [],
  transitions: [],
  children: [],
};

const meta = {
  title: 'Matters/ProceedingForm',
  component: ProceedingForm,
  args: {
    workspaceId: '00000000-0000-4000-8000-00000000a001',
    matterId: '00000000-0000-4000-8000-0000000a1001',
    forums: FORUMS,
    rows: [
      { id: editing.id, label: 'WP 1234/2025' },
      { id: '00000000-0000-4000-8000-0000000c1004', label: 'WA 88/2026' },
    ],
    actions,
    onClose: fn(),
    onOpenExisting: fn(),
    onMergeMatter: fn(),
  },
} satisfies Meta<typeof ProceedingForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Add: Story = {
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Save proceeding' })).toBeVisible();
  },
};

export const Edit: Story = {
  args: { editing },
  play: async () => {
    await expect(await screen.findByDisplayValue('1234')).toBeVisible();
  },
};

export const NoForums: Story = {
  args: { forums: [] },
};

export const DuplicateInThisMatter: Story = {
  args: {
    actions: {
      ...actions,
      findDuplicates: fn(() =>
        Promise.resolve({
          ok: true as const,
          data: [
            {
              id: editing.id,
              matterId: '00000000-0000-4000-8000-0000000a1001',
              sameMatter: true,
              caseType: 'WP',
              number: '1234',
              year: 2025,
              cnr: null,
            },
          ],
        }),
      ),
    },
  },
};

export const Offline: Story = {
  args: { offline: true },
};

export const Tamil: Story = {
  args: {
    forums: FORUMS.map((f) => ({ ...f, name: 'சென்னை உயர் நீதிமன்றம், சென்னை' })),
  },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: {
    forums: FORUMS.map((f) => ({ ...f, name: 'ಕರ್ನಾಟಕ ಉಚ್ಚ ನ್ಯಾಯಾಲಯ, ಬೆಂಗಳೂರು' })),
  },
  globals: { locale: 'kn' },
};
