// The drafts list (#826): a story per component and state. Fictional data only. The server action
// is a mock handler; the route shell is covered by the page tests and the e2e journeys.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import type { DraftRowView } from '../../lib/drafting/list.ts';
import DraftsLoading from '../../app/(app)/w/[slug]/drafts/loading.tsx';
import DraftsError from '../../app/(app)/w/[slug]/drafts/error.tsx';
import { PermissionDeniedPage } from '../shell/permission-denied-page.tsx';

import { DraftsList } from './drafts-list.tsx';
import { DraftsOfflineBanner } from './drafts-offline-banner.tsx';
import { TemplatePicker } from './template-picker.tsx';

const ID = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const WORKSPACE = ID(1);
const SLUG = 'sample-chambers';

const rows: DraftRowView[] = [
  {
    id: ID(10),
    href: `/w/${SLUG}/drafts/${ID(10)}`,
    title: 'Mention memo: early listing',
    matterId: ID(20),
    matterTitle: 'Meera Rao v. Example Traders (fictional)',
    templateName: 'Mention memo (Madras HC)',
    updatedAt: '2026-11-03T05:30:00.000Z',
    citations: { verified: 3, not_found: 1, unknown: 2 },
    consistency: { error: 1, warn: 2, info: 0 },
  },
  {
    id: ID(11),
    href: `/w/${SLUG}/drafts/${ID(11)}`,
    title: 'Synopsis and list of dates',
    matterId: null,
    matterTitle: null,
    templateName: 'Synopsis',
    updatedAt: '2026-11-01T09:00:00.000Z',
    citations: { verified: 0, not_found: 0, unknown: 0 },
    consistency: null,
  },
  {
    id: ID(12),
    href: `/w/${SLUG}/drafts/${ID(12)}`,
    title: 'Counter affidavit',
    matterId: ID(20),
    matterTitle: 'Meera Rao v. Example Traders (fictional)',
    templateName: 'Affidavit',
    updatedAt: '2026-10-28T09:00:00.000Z',
    citations: { verified: 5, not_found: 0, unknown: 0 },
    consistency: { error: 0, warn: 0, info: 0 },
  },
];

const templates = [
  { id: ID(30), name: 'Mention memo (Madras HC)' },
  { id: ID(31), name: 'Early listing memo' },
  { id: ID(32), name: 'Synopsis' },
];
const matters = [
  { id: ID(20), title: 'Meera Rao v. Example Traders (fictional)' },
  { id: ID(21), title: 'State v. Sample Mills (fictional)' },
];
const createAction = fn(() => Promise.resolve({ ok: true as const, data: { id: ID(40) } }));

const meta = {
  title: 'Drafting/Drafts list',
  component: DraftsList,
  args: {
    workspaceId: WORKSPACE,
    slug: SLUG,
    rows,
    matters,
    matterFilter: null,
    templates,
    createAction,
  },
} satisfies Meta<typeof DraftsList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
export const FilteredByMatter: Story = {
  args: { rows: rows.filter((r) => r.matterId !== null), matterFilter: ID(20) },
};
export const Empty: Story = { args: { rows: [] } };
export const FilteredEmpty: Story = { args: { rows: [], matterFilter: ID(21) } };
export const ReadOnly: Story = { args: { canCreate: false } };
export const Offline: Story = { args: { forceOffline: true } };

export const PickerOpen: Story = { args: { initialPickerOpen: true } };

export const Picker: StoryObj<typeof TemplatePicker> = {
  render: () => (
    <TemplatePicker
      workspaceId={WORKSPACE}
      slug={SLUG}
      templates={templates}
      matters={matters}
      createAction={createAction}
      initialOpen
    />
  ),
};
export const PickerError: StoryObj<typeof TemplatePicker> = {
  render: () => (
    <TemplatePicker
      workspaceId={WORKSPACE}
      slug={SLUG}
      templates={templates}
      matters={matters}
      createAction={() => Promise.resolve({ ok: false, error: { code: 'FORBIDDEN', message: '' } })}
      initialOpen
    />
  ),
};
export const PickerOffline: StoryObj<typeof TemplatePicker> = {
  render: () => (
    <TemplatePicker
      workspaceId={WORKSPACE}
      slug={SLUG}
      templates={templates}
      matters={matters}
      createAction={createAction}
      initialOpen
      forceOffline
    />
  ),
};
export const PickerNoTemplates: StoryObj<typeof TemplatePicker> = {
  render: () => (
    <TemplatePicker
      workspaceId={WORKSPACE}
      slug={SLUG}
      templates={[]}
      matters={[]}
      createAction={createAction}
      initialOpen
    />
  ),
};

export const ListOffline: StoryObj<typeof DraftsOfflineBanner> = {
  render: () => <DraftsOfflineBanner forced />,
};
export const Loading: StoryObj<typeof DraftsLoading> = { render: () => <DraftsLoading /> };
export const ErrorWithRequestId: StoryObj<typeof DraftsError> = {
  render: () => (
    <DraftsError error={Object.assign(new Error('boom'), { digest: '2481516' })} reset={fn()} />
  ),
};
export const PermissionDenied: StoryObj<typeof PermissionDeniedPage> = {
  render: () => <PermissionDeniedPage />,
};
