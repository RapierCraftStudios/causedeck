// check-stories: n/a Hover, FocusVisible, Active, Disabled, Invalid, WithIcon, RtlNeutral (a read-only document surface: the chip and popover have their own stories)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { ProvenanceLink, type SourcedLine } from './provenance-link';
import { ReadinessMeter } from './readiness-meter';
import { SectionLabel, SheetPage } from './sheet-page';

const line = (quote: string): SourcedLine => ({
  source_type: 'document',
  source_ref: null,
  anchor_id: '7b0a6a3e-0f3e-4f65-9d5b-2c1b8f3a9d11',
  confidence: 0.92,
  confirmation_state: 'confirmed',
  page_no: 3,
  quote,
});

const SEGMENTS = [
  { key: 'stage', label: 'Stage known', met: true },
  { key: 'order', label: 'Last order confirmed', met: true },
  { key: 'obligations', label: 'Obligations reconciled', met: false },
  { key: 'carry', label: 'Carry reviewed', met: false },
];

function Sheet({
  order,
  lang,
  meter = true,
  children,
}: {
  order: string;
  lang?: string;
  meter?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <SheetPage {...(lang ? { lang } : {})}>
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-2xl">Rajan v. State</h1>
        {meter ? <ReadinessMeter score={50} label="Ready 50 of 100" segments={SEGMENTS} /> : null}
      </header>
      <section className="mt-6 grid gap-1">
        <SectionLabel>Last order</SectionLabel>
        <p className="border-l-2 pl-3">{order}</p>
        <ProvenanceLink line={line(order)} sourceLabel="Order of 12 Aug" />
      </section>
      {children}
    </SheetPage>
  );
}

const meta = {
  title: 'Patterns/BriefSheet',
  component: Sheet,
  args: { order: 'Notice ordered to the respondents; list after four weeks.' },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('article')).toBeInTheDocument();
    await expect(canvas.getByRole('meter', { name: 'Ready 50 of 100' })).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { order: '' },
  render: () => (
    <SheetPage>
      <SectionLabel>Last order</SectionLabel>
      <p className="text-muted-foreground">Nothing on record yet.</p>
    </SheetPage>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Nothing on record yet.')).toBeInTheDocument();
  },
};

export const Loading: Story = {
  render: () => (
    <SheetPage aria-busy="true">
      <div className="bg-muted h-8 w-64 animate-pulse rounded" />
      <div className="bg-muted mt-6 h-16 w-full animate-pulse rounded" />
    </SheetPage>
  ),
};

export const SectionError: Story = {
  render: () => (
    <SheetPage>
      <SectionLabel>From the documents</SectionLabel>
      <p role="alert">Couldn’t load documents for this brief. Retry</p>
    </SheetPage>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toBeInTheDocument();
  },
};

export const Offline: Story = {
  render: (args) => (
    <>
      <p role="status" className="mb-3 text-center text-sm">
        Offline. Brief saved at 8:36 pm
      </p>
      <Sheet {...args} />
    </>
  ),
};

export const Denied: Story = {
  render: () => (
    <SheetPage>
      <p role="alert">You don’t have access to this matter.</p>
    </SheetPage>
  ),
};

export const LongText: Story = {
  args: { order: 'Counter affidavit to be filed with the leave of the Court. '.repeat(8) },
};

export const Tamil: Story = {
  args: { order: 'எதிர்மனுதாரர்களுக்கு அறிவிப்பு அனுப்ப உத்தரவு.', lang: 'ta' },
};

export const Kannada: Story = {
  args: { order: 'ಪ್ರತಿವಾದಿಗಳಿಗೆ ನೋಟಿಸ್ ನೀಡಲು ಆದೇಶ.', lang: 'kn' },
};
