// check-stories: n/a Disabled (static presentational primitives with no disabled state)
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
      <ErrorState />
    </div>
  ),
};

export const Offline: Story = {
  render: () => (
    <div className="p-4">
      <OfflineBanner />
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
