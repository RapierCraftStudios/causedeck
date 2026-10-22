// Matters list client half (#388): header with `New matter`, the table (>= 768 px) or cards, the
// empty and filtered-empty states, a read-only member and the permission-denied screen. The create
// action is mocked with `fn()`; the router is the framework's mock.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import type { MatterRowView } from '../../lib/matters/graph-deps.ts';
import type { Result } from '../../lib/safe-action.ts';
import type { CreateMatterAction, NewMatterInput } from './new-matter-dialog.tsx';
import { MattersList, MattersPermissionDenied } from './matters-list.tsx';

const created = (input: NewMatterInput): Promise<Result<{ id: string; title: string }>> =>
  Promise.resolve({
    ok: true,
    data: { id: '00000000-0000-4000-8000-0000000b00ff', title: input.title },
  });

const row = (id: string, over: Partial<MatterRowView>): MatterRowView => ({
  id,
  href: `/w/demo/matters/${id}`,
  title: 'Rao v. State of Tamil Nadu',
  sensitive: false,
  petitioner: 'K. Rao',
  respondent: 'State of Tamil Nadu',
  forum: 'Madras High Court',
  stage: 'hearing',
  proceedingCount: 2,
  nextDate: { text: 'Mon, 02 Nov 2026', relative: 'in 12 days', confirmed: true },
  owner: 'Meera Iyer',
  updated: '20 Oct 2026',
  updatedAt: '2026-10-20T04:00:00.000Z',
  ...over,
});

const ROWS = [
  row('00000000-0000-4000-8000-0000000b0001', {}),
  row('00000000-0000-4000-8000-0000000b0002', {
    title: 'Selvi v. Fictional Transport Corporation',
    petitioner: 'Selvi',
    respondent: 'Fictional Transport Corporation',
    sensitive: true,
    nextDate: { text: 'Fri, 06 Nov 2026', relative: 'in 16 days', confirmed: false },
  }),
];

const header = <h1 className="font-serif text-2xl font-medium">Matters</h1>;

const meta = {
  title: 'Matters/MattersList',
  component: MattersList,
  args: {
    rows: ROWS,
    state: { sort: 'next_date' },
    slug: 'demo',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    canWrite: true,
    createAction: fn<CreateMatterAction>(created),
    header,
  },
} satisfies Meta<typeof MattersList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'New matter' })).toBeEnabled();
    await expect(canvas.getAllByRole('link', { name: /Open matter/ }).length).toBeGreaterThan(0);
  },
};

/** A viewer: `New matter` is absent, not disabled. */
export const ReadOnly: Story = {
  args: { canWrite: false },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'New matter' })).toBeNull();
  },
};

export const Empty: Story = {
  args: { rows: [], empty: 'empty' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No matters yet')).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Open Inbox' })).toBeVisible();
  },
};

export const FilteredEmpty: Story = {
  args: { rows: [], empty: 'filtered', state: { sort: 'next_date', q: 'zzz' } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No matters match these filters.')).toBeVisible();
  },
};

export const PermissionDenied: Story = {
  render: () => <MattersPermissionDenied />,
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("Your role can't see this. Ask the chamber owner."),
    ).toBeVisible();
  },
};

export const Tamil: Story = {
  args: {
    rows: [
      row('00000000-0000-4000-8000-0000000b0011', {
        title: 'முருகன் எதிர் தமிழ்நாடு அரசு',
        petitioner: 'முருகன் இளங்கோவன்',
        respondent: 'தமிழ்நாடு அரசு',
      }),
    ],
  },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: {
    rows: [
      row('00000000-0000-4000-8000-0000000b0021', {
        title: 'ಲಕ್ಷ್ಮಿ ವಿರುದ್ಧ ಕರ್ನಾಟಕ ಸರ್ಕಾರ',
        petitioner: 'ಲಕ್ಷ್ಮಿ ಗೌಡ',
        respondent: 'ಕರ್ನಾಟಕ ಸರ್ಕಾರ',
      }),
    ],
  },
  globals: { locale: 'kn' },
};
