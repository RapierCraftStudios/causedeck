// People tab panel (#393): people grouped by role edge with kind, aliases and (clients and
// professional contacts only) contact details. Writers get Add, Edit and Remove; others get none of
// them (absent, not disabled). Empty, offline and Tamil/Kannada name samples. Actions are mocked.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import type { PeopleGroupView } from '../../lib/matters/people.ts';
import type { Result } from '../../lib/safe-action.ts';
import { PeoplePanel, type SetRoleEdgeAction } from './people-panel.tsx';
import type { UpsertPersonAction } from './person-form.tsx';

const ok =
  <T,>(data: T) =>
  (): Promise<Result<T>> =>
    Promise.resolve({ ok: true, data });

const GROUPS: PeopleGroupView[] = [
  {
    kind: 'represents',
    people: [
      {
        id: '00000000-0000-4000-8000-0000000e0001',
        name: 'Ilango Murugesan',
        aliases: ['M. Ilango'],
        kind: 'client',
        contact: { email: 'ilango@example.e2e.test', phone: '+91 98400 00001', address: null },
        onMatter: true,
        onProceeding: false,
      },
    ],
  },
  {
    kind: 'appears_for',
    people: [
      {
        id: '00000000-0000-4000-8000-0000000e0002',
        name: 'Adv. Meera Iyer',
        aliases: [],
        kind: 'advocate',
        contact: null,
        onMatter: true,
        onProceeding: true,
      },
    ],
  },
  { kind: 'instructed_by', people: [] },
  {
    kind: 'opposes',
    people: [
      {
        id: '00000000-0000-4000-8000-0000000e0003',
        name: 'Fictional Housing Board',
        aliases: [],
        kind: 'party',
        contact: null,
        onMatter: false,
        onProceeding: true,
      },
    ],
  },
];

const named = (kind: PeopleGroupView['kind'], id: string, name: string): PeopleGroupView => ({
  kind,
  people: [
    { id, name, aliases: [], kind: 'party', contact: null, onMatter: true, onProceeding: false },
  ],
});

const meta = {
  title: 'Matters/PeoplePanel',
  component: PeoplePanel,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    matterId: '00000000-0000-4000-8000-0000000b0001',
    groups: GROUPS,
    canWrite: true,
    actions: {
      upsertPerson: fn<UpsertPersonAction>(ok({ id: 'p', name: 'p' })),
      setRoleEdge: fn<SetRoleEdgeAction>(ok({ removed: true as const })),
    },
  },
} satisfies Meta<typeof PeoplePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Writer: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Ilango Murugesan')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Add person' })).toBeEnabled();
  },
};

/** A viewer: no Add, Edit or Remove at all. */
export const ReadOnly: Story = {
  args: { canWrite: false },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Add person' })).toBeNull();
    await expect(canvas.getByText('Adv. Meera Iyer')).toBeVisible();
  },
};

export const Empty: Story = {
  args: { groups: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No people recorded for this matter yet.')).toBeVisible();
  },
};

export const EmptyReadOnly: Story = {
  args: { groups: [], canWrite: false },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Add person' })).toBeNull();
  },
};

export const Offline: Story = {
  args: { forcedOffline: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Add person' })).toBeDisabled();
  },
};

export const Tamil: Story = {
  args: {
    groups: [
      named('represents', '00000000-0000-4000-8000-0000000e0011', 'முருகன் இளங்கோவன்'),
      named('opposes', '00000000-0000-4000-8000-0000000e0012', 'தமிழ்நாடு அரசு'),
    ],
  },
  globals: { locale: 'ta' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('முருகன் இளங்கோவன்')).toHaveAttribute('lang', 'ta');
  },
};

export const Kannada: Story = {
  args: {
    groups: [
      named('represents', '00000000-0000-4000-8000-0000000e0021', 'ಲಕ್ಷ್ಮಿ ಗೌಡ'),
      named('opposes', '00000000-0000-4000-8000-0000000e0022', 'ಕರ್ನಾಟಕ ಸರ್ಕಾರ'),
    ],
  },
  globals: { locale: 'kn' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('ಲಕ್ಷ್ಮಿ ಗೌಡ')).toHaveAttribute('lang', 'kn');
  },
};
