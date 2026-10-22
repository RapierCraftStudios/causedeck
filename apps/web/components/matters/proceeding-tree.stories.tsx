// Proceedings tree (#392): the matter's proceedings as a `role="tree"` with an appeal chain and
// W.M.P. children, the writer's toolbar, and the offline, read-only and empty states.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import type { ForumOption, ProceedingRowView } from '../../lib/matters/proceedings-view.ts';

import { ProceedingTree, type ProceedingTreeActions } from './proceeding-tree.tsx';

const WORKSPACE = '00000000-0000-4000-8000-00000000a001';
const ok = () => Promise.resolve({ ok: true as const, data: null });
const okId = () =>
  Promise.resolve({
    ok: true as const,
    data: { id: '00000000-0000-4000-8000-0000000c1009' },
  });

const actions: ProceedingTreeActions = {
  form: {
    create: fn(okId),
    update: fn(okId),
    link: fn(ok),
    findDuplicates: fn(() => Promise.resolve({ ok: true as const, data: [] })),
  },
  transition: fn(ok),
  merge: {
    search: fn(() => Promise.resolve({ ok: true as const, data: [] })),
    preview: fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          proceedings: [],
          documents: 0,
          obligations: 0,
          crossingLinks: 0,
          intoSensitive: false,
          fromSensitive: false,
          blocked: null,
        },
      }),
    ),
    merge: fn(() => Promise.resolve({ ok: true as const, data: { undo: null } })),
    undo: fn(ok),
  },
  split: {
    preview: fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          proceedings: [],
          documents: 0,
          obligations: 0,
          crossingLinks: 0,
          intoSensitive: false,
          fromSensitive: false,
          blocked: null,
        },
      }),
    ),
    split: fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { undo: null, newMatterHref: '/w/chennai-solo/matters/new' },
      }),
    ),
    undo: fn(ok),
  },
};

const row = (id: string, overrides: Partial<ProceedingRowView> = {}): ProceedingRowView => ({
  id: `00000000-0000-4000-8000-0000000c${id}`,
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
  cnr: null,
  stage: null,
  nextDate: { text: '14 Mar 2026', relative: 'in 2 days' },
  links: [],
  transitions: ['disposed'],
  children: [],
  ...overrides,
});

const wmp = (id: string, number: string, depth = 2) =>
  row(id, {
    depth,
    kind: 'misc',
    caseType: 'WMP',
    caseNumber: { type: 'WMP', number, year: 2025 },
    label: `WMP ${number}/2025`,
    nextDate: null,
    transitions: [],
  });

/** A writ with two W.M.P.s, and the writ appeal that appeals from it. */
const CHAIN: ProceedingRowView[] = [
  row('1001', { children: [wmp('1002', '4021'), wmp('1003', '4022')] }),
  row('1004', {
    kind: 'appeal',
    caseType: 'WA',
    caseNumber: { type: 'WA', number: '88', year: 2026 },
    label: 'WA 88/2026',
    state: 'filed',
    links: [
      {
        linkId: '00000000-0000-4000-8000-0000000d1001',
        kind: 'appeal_from',
        direction: 'from',
        otherLabel: 'WP 1234/2025',
        otherMatterId: null,
      },
    ],
    children: [wmp('1005', '77', 2)],
  }),
];

const FORUMS: ForumOption[] = [
  {
    id: '00000000-0000-4000-8000-0000000f0001',
    name: 'High Court of Madras, Chennai',
    code: 'in.tn.madras-hc.principal.appellate',
    caseTypes: [
      { code: 'WP', label: 'WP', aliases: ['Writ Petition'] },
      { code: 'WA', label: 'WA', aliases: ['Writ Appeal'] },
      { code: 'WMP', label: 'WMP', aliases: ['Writ Miscellaneous Petition'] },
    ],
  },
];

const meta = {
  title: 'Matters/ProceedingTree',
  component: ProceedingTree,
  args: {
    workspaceId: WORKSPACE,
    slug: 'chennai-solo',
    matterId: '00000000-0000-4000-8000-0000000a1001',
    rows: CHAIN,
    forums: FORUMS,
    canWrite: true,
    actions,
  },
  parameters: {
    // Each treeitem carries its whole proceeding card (state, forum, next date, chips) and its
    // child proceedings, so a name from content would read the entire subtree. It is named by its
    // case number on purpose (WAI-ARIA tree pattern); axe's label-content-name-mismatch cannot hold.
    a11y: { config: { rules: [{ id: 'label-content-name-mismatch', enabled: false }] } },
  },
} satisfies Meta<typeof ProceedingTree>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AppealChainWithWmp: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('tree', { name: 'Proceedings of this matter' })).toBeVisible();
    await expect(canvas.getAllByRole('treeitem').length).toBeGreaterThanOrEqual(5);
  },
};

export const ReadOnly: Story = {
  args: { canWrite: false, actions: undefined },
};

export const Offline: Story = {
  args: { forcedOffline: true },
};

export const Empty: Story = {
  args: { rows: [] },
};

export const Unnumbered: Story = {
  args: {
    rows: [
      row('2001', {
        state: 'sr_fr',
        caseNumber: null,
        unnumbered: true,
        srNo: '5678',
        nextDate: null,
        transitions: ['numbered'],
      }),
    ],
  },
};

export const Tamil: Story = {
  args: {
    rows: CHAIN.map((r) => ({ ...r, forum: 'சென்னை உயர் நீதிமன்றம், சென்னை' })),
  },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: {
    rows: CHAIN.map((r) => ({ ...r, forum: 'ಕರ್ನಾಟಕ ಉಚ್ಚ ನ್ಯಾಯಾಲಯ, ಬೆಂಗಳೂರು' })),
  },
  globals: { locale: 'kn' },
};
