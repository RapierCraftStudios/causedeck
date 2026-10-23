// Matter graph (#41): an appeal chain O.S. -> A.S. -> S.A. beside a W.P. with its W.A., a parent
// with more than three W.M.P.s folded behind one chip, an SR-stage proceeding that has no number
// yet, and Tamil and Kannada samples (Noto fallback, line height).
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent } from 'storybook/test';

import type { GraphNodeView } from '../../../lib/matters/timeline.ts';

import type { LayoutEdgeInput, LayoutGroupInput } from './graph-layout.ts';
import { GraphView } from './graph-view.tsx';

const id = (n: number) => `00000000-0000-4000-8000-0000000d${String(n).padStart(4, '0')}`;

const node = (
  n: number,
  caseType: string,
  number: string | null,
  over: Partial<GraphNodeView> = {},
): GraphNodeView => ({
  id: id(n),
  parentId: null,
  label: number === null ? caseType : `${caseType} ${number}/2025`,
  caseType,
  caseNumber: number === null ? null : { number, year: 2025 },
  unnumbered: number === null,
  srFrNo: null,
  forum: 'Madras HC',
  state: 'numbered',
  relations: [],
  ...over,
});

const CHAIN: GraphNodeView[] = [
  node(1, 'O.S.', '31', {
    forum: 'Chennai CCC',
    relations: [{ kind: 'appeal_from', direction: 'to', label: 'A.S. 72/2025' }],
  }),
  node(2, 'A.S.', '72', {
    relations: [
      { kind: 'appeal_from', direction: 'from', label: 'O.S. 31/2025' },
      { kind: 'appeal_from', direction: 'to', label: 'S.A. 9/2025' },
    ],
  }),
  node(3, 'S.A.', '9', {
    relations: [{ kind: 'appeal_from', direction: 'from', label: 'A.S. 72/2025' }],
  }),
  node(4, 'W.P.', '678', {
    relations: [{ kind: 'connected', direction: 'from', label: 'O.S. 31/2025' }],
  }),
];

const CHAIN_EDGES: LayoutEdgeInput[] = [
  { id: 'l1', from: id(2), to: id(1), kind: 'appeal_from' },
  { id: 'l2', from: id(3), to: id(2), kind: 'appeal_from' },
  { id: 'l3', from: id(4), to: id(1), kind: 'connected' },
];

const WMP: GraphNodeView[] = Array.from({ length: 12 }, (_, i) =>
  node(100 + i, 'W.M.P.', String(i + 1), { parentId: id(4), state: 'numbered' }),
);

const GROUP: (LayoutGroupInput & { caseType: string })[] = [
  { id: `group:${id(4)}`, parentId: id(4), caseType: 'W.M.P.', memberIds: WMP.map((n) => n.id) },
];

const WMP_EDGES: LayoutEdgeInput[] = WMP.map((n) => ({
  id: `parent:${n.id}`,
  from: id(4),
  to: n.id,
  kind: 'parent_of',
}));

const meta = {
  title: 'Matters/Timeline/GraphView',
  component: GraphView,
  args: {
    nodes: CHAIN,
    edges: CHAIN_EDGES,
    groups: [],
    selected: [],
    onSelect: fn(),
    onClear: fn(),
  },
} satisfies Meta<typeof GraphView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AppealChain: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('tree', { name: 'Proceedings of this matter' })).toBeVisible();
    await expect(canvas.getAllByRole('treeitem')).toHaveLength(4);
    await expect(canvas.getByText('Line styles')).toBeVisible();
  },
};

export const CollapsedMiscGroup: Story = {
  args: { nodes: [...CHAIN, ...WMP], edges: [...CHAIN_EDGES, ...WMP_EDGES], groups: GROUP },
  play: async ({ canvas }) => {
    const chip = canvas.getByRole('treeitem', { expanded: false });
    await expect(chip).toHaveTextContent('W.M.P. × 12');
    chip.focus();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.getByRole('treeitem', { expanded: true })).toBeVisible();
    await expect(canvas.getAllByRole('treeitem')).toHaveLength(4 + 1 + 12);
  },
};

export const ExpandedMiscGroup: Story = {
  args: {
    nodes: [...CHAIN, ...WMP],
    edges: [...CHAIN_EDGES, ...WMP_EDGES],
    groups: GROUP,
    defaultExpanded: GROUP.map((g) => g.id),
  },
};

export const SrStageUnnumbered: Story = {
  args: {
    nodes: [
      node(201, 'W.P.', null, { state: 'sr_fr', srFrNo: 'SR 5678', label: 'W.P. SR 5678' }),
      ...CHAIN.slice(0, 1),
    ],
    edges: [],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Unnumbered')).toBeVisible();
    await expect(canvas.getByText('SR/FR no. SR 5678')).toBeVisible();
  },
};

export const Selected: Story = {
  args: { selected: [id(2)] },
};

export const Tamil: Story = {
  args: {
    nodes: CHAIN.map((n) => ({ ...n, forum: 'சென்னை உயர் நீதிமன்றம்', caseType: n.caseType })),
  },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: {
    nodes: CHAIN.map((n) => ({ ...n, forum: 'ಕರ್ನಾಟಕ ಉಚ್ಚ ನ್ಯಾಯಾಲಯ' })),
  },
  globals: { locale: 'kn' },
};
