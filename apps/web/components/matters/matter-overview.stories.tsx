// The Overview tab (#390): next date, the conflict card, proceedings summary, synopsis, people,
// recent documents and open obligations, in the permission and connectivity states it can be in.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import type { ListingView, MatterOverviewView } from '../../lib/matters/workspace.ts';

import { MatterOverview } from './matter-overview.tsx';

const listing = (
  overrides: Partial<ListingView> & Pick<ListingView, 'listingId'>,
): ListingView => ({
  proceedingId: 'p-1',
  date: '2026-11-02',
  text: 'Mon, 02 Nov 2026',
  relative: 'in 12 days',
  proposed: false,
  stage: 'listed',
  source: { kind: 'manual', state: 'confirmed', sourceRef: null, confidence: null },
  ...overrides,
});

const matter: MatterOverviewView = {
  id: 'm-1',
  title: 'Ilango v. Fictional Housing Board',
  status: 'active',
  sensitive: false,
  owner: 'Meera Rao',
  clients: [{ id: 'c-1', name: 'Ilango' }],
  nextDate: listing({ listingId: 'l-1' }),
  conflicts: [],
  proceedings: {
    count: 3,
    byState: [
      { state: 'numbered', count: 2 },
      { state: 'disposed', count: 1 },
    ],
    lead: { caseType: 'W.P.', number: '1234', year: 2025, forum: 'Madras High Court' },
  },
  openObligations: 2,
  recentDocuments: [
    { id: 'd-1', kind: 'order', language: 'en', textStatus: 'layer', added: '12 Oct 2026' },
    { id: 'd-2', kind: 'pleading', language: null, textStatus: 'pending', added: '3 Oct 2026' },
  ],
  people: [{ kind: 'represents', people: [{ id: 'pe-1', name: 'Ilango' }] }],
  synopsis: 'Challenge to the allotment cancellation order of 2025.',
  synopsisDenied: false,
};

const conflict = {
  proceedingId: 'p-1',
  current: listing({ listingId: 'l-1' }),
  proposed: listing({
    listingId: 'l-2',
    date: '2026-11-09',
    text: 'Mon, 09 Nov 2026',
    relative: 'in 19 days',
    proposed: true,
    source: { kind: 'adapter', state: 'proposed', sourceRef: 'cause-list', confidence: 0.8 },
  }),
};

const meta = {
  title: 'Matters/MatterOverview',
  component: MatterOverview,
  parameters: { layout: 'fullscreen' },
  args: {
    matter,
    workspaceId: 'ws-1',
    slug: 'demo',
    canWrite: true,
    actions: {
      confirmNextDate: fn(() =>
        Promise.resolve({
          ok: true as const,
          data: { listingId: 'l-1', date: '2026-11-02', confirmationState: 'confirmed' },
        }),
      ),
      chooseNextDateSource: fn(() =>
        Promise.resolve({
          ok: true as const,
          data: { listingId: 'l-1', date: '2026-11-02', confirmationState: 'confirmed' },
        }),
      ),
      updateMatter: fn(() =>
        Promise.resolve({
          ok: true as const,
          data: { id: 'm-1', title: matter.title, synopsis: matter.synopsis },
        }),
      ),
    },
  },
  decorators: [
    (Story) => (
      <div className="p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MatterOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('region', { name: 'Next date' })).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'Proceedings' })).toBeVisible();
  },
};

export const ProposedNextDate: Story = {
  args: {
    matter: {
      ...matter,
      nextDate: listing({
        listingId: 'l-3',
        proposed: true,
        source: { kind: 'adapter', state: 'proposed', sourceRef: 'cause-list', confidence: 0.7 },
      }),
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Confirm' })).toBeVisible();
  },
};

export const WithConflict: Story = {
  args: { matter: { ...matter, conflicts: [conflict] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /Choose A/ })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /Choose B/ })).toBeVisible();
  },
};

export const Empty: Story = {
  args: {
    matter: {
      ...matter,
      nextDate: null,
      proceedings: { count: 0, byState: [], lead: null },
      openObligations: 0,
      recentDocuments: [],
      people: [],
      synopsis: null,
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No next date')).toBeVisible();
  },
};

export const SynopsisDenied: Story = {
  args: { canWrite: false, matter: { ...matter, synopsis: null, synopsisDenied: true } },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Confirm' })).toBeNull();
  },
};

export const ReadOnly: Story = {
  args: { canWrite: false, matter: { ...matter, conflicts: [conflict] } },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: /Choose A/ })).toBeNull();
  },
};

export const Offline: Story = {
  args: { forcedOffline: true, matter: { ...matter, conflicts: [conflict] } },
};

export const Tamil: Story = {
  args: {
    matter: {
      ...matter,
      title: 'இளங்கோ எதிர் தமிழ்நாடு வீட்டுவசதி வாரியம் (கற்பனை)',
      owner: 'மீரா ராவ்',
      clients: [{ id: 'c-1', name: 'இளங்கோ' }],
      people: [{ kind: 'represents', people: [{ id: 'pe-1', name: 'இளங்கோ' }] }],
      synopsis: 'ஒதுக்கீடு ரத்து உத்தரவுக்கு எதிரான மனு.',
    },
  },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: {
    matter: {
      ...matter,
      title: 'ಸುರೇಶ ವಿರುದ್ಧ ಕಾಲ್ಪನಿಕ ನಗರಾಭಿವೃದ್ಧಿ ಪ್ರಾಧಿಕಾರ',
      owner: 'ಮೀರಾ ರಾವ್',
      clients: [{ id: 'c-1', name: 'ಸುರೇಶ' }],
      people: [{ kind: 'represents', people: [{ id: 'pe-1', name: 'ಸುರೇಶ' }] }],
      synopsis: 'ಹಂಚಿಕೆ ರದ್ದತಿ ಆದೇಶದ ವಿರುದ್ಧದ ಅರ್ಜಿ.',
    },
  },
  globals: { locale: 'kn' },
};
