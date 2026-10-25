// check-stories: n/a Disabled, Hover, FocusVisible, Active (static presentational primitives: no disabled, hover, focus or pressed state; the board's cards own interaction)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { ErrorState } from '../states/error-state';
import { OfflineBanner } from '../states/offline-banner';
import { PermissionDenied as PermissionDeniedScreen } from '../states/permission-denied';
import { ClashBracket } from './clash-bracket';
import { HallHeader } from './hall-header';
import { ItemNumeral } from './item-numeral';

const meta = {
  title: 'Patterns/CourtDay',
  component: HallHeader,
  args: { title: 'Hall 4', detail: '3 items · Court is at item 2' },
} satisfies Meta<typeof HallHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="flex max-w-sm flex-col gap-3 p-4">
      <HallHeader {...args} />
      <ItemNumeral itemNo="12A" />
      <ClashBracket title="Clash" statement="Listed on the same date in different halls." />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('heading', { name: 'Hall 4' })).toBeVisible();
    await expect(c.getByRole('note')).toBeVisible();
  },
};

export const Empty: Story = {
  render: () => (
    <div className="p-4">
      <HallHeader title="Hall 9" detail="Nothing listed" />
      <ItemNumeral itemNo={null} />
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div className="p-4" aria-busy="true">
      <HallHeader title="Hall 4" />
    </div>
  ),
};

export const ErrorStory: Story = {
  name: 'Error',
  render: () => (
    <div className="p-4">
      <ErrorState title="The court day could not load." onRetry={() => undefined} />
    </div>
  ),
};

export const Offline: Story = {
  render: () => (
    <div className="p-4">
      <OfflineBanner savedAt={new Date('2030-01-02T04:30:00Z')} />
    </div>
  ),
};

export const PermissionDenied: Story = {
  render: () => (
    <div className="p-4">
      <PermissionDeniedScreen />
    </div>
  ),
};

/** A clash is the pattern's invalid state: two listings on one date in different halls. */
export const Invalid: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-3 p-4">
      <ClashBracket
        title="Clash"
        statement="Listed on 26 Oct in Hall 4 and Hall 9 for the same advocate."
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('note')).toBeVisible();
  },
};

export const WithIcon: Story = {
  render: (args) => (
    <div className="flex max-w-sm flex-col gap-3 p-4">
      <HallHeader {...args} />
      <ItemNumeral itemNo="7" />
      <ItemNumeral itemNo="12A" />
    </div>
  ),
};

export const LongText: Story = {
  args: {
    title: 'Court Hall 12, Main Building, first floor (Division Bench, writ appeals)',
    detail: '48 items · Court is at item 112 of the supplementary list and connected matters',
  },
  render: (args) => (
    <div className="flex max-w-80 flex-col gap-3 p-4">
      <HallHeader {...args} />
      <ClashBracket
        title="Clash"
        statement="WA 1204/2026 and 31 connected appeals are listed on the same date in Hall 12 and Hall 3."
      />
    </div>
  ),
};

export const RtlNeutral: Story = {
  render: (args) => (
    <div dir="rtl" className="flex max-w-sm flex-col gap-3 p-4">
      <HallHeader {...args} />
      <ItemNumeral itemNo="12A" />
    </div>
  ),
};

export const Tamil: Story = {
  args: { title: 'அறை 4', detail: '3 வழக்குகள் · நீதிமன்றம் வழக்கு 2-இல் உள்ளது' },
  render: (args) => (
    <div className="flex max-w-sm flex-col gap-3 p-4">
      <HallHeader {...args} />
      <ClashBracket title="மோதல்" statement="ஒரே நாளில் வெவ்வேறு அறைகளில் பட்டியலிடப்பட்டுள்ளது." />
    </div>
  ),
};

export const Kannada: Story = {
  args: { title: 'ಕೊಠಡಿ 4', detail: '3 ಪ್ರಕರಣಗಳು · ನ್ಯಾಯಾಲಯ ಪ್ರಕರಣ 2 ರಲ್ಲಿದೆ' },
  render: (args) => (
    <div className="flex max-w-sm flex-col gap-3 p-4">
      <HallHeader {...args} />
      <ClashBracket title="ಘರ್ಷಣೆ" statement="ಒಂದೇ ದಿನ ಬೇರೆ ಬೇರೆ ಕೊಠಡಿಗಳಲ್ಲಿ ಪಟ್ಟಿಯಾಗಿದೆ." />
    </div>
  ),
};
