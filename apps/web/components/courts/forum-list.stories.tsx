// Courts index grid (#399): forums by city and court with search, the planned (disabled) forums
// apart, the roving-tabindex keyboard model, and the load-error state.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { forum, sampleIndex } from './__tests__/fixtures.ts';
import { CourtsLoadError, ForumList } from './forum-list.tsx';

const at = new Date('2026-10-21T04:00:00Z');

/** The sample index with the Madras HC appellate forum's newest list degraded. */
function degradedIndex() {
  const index = sampleIndex();
  return {
    ...index,
    cities: index.cities.map((city) => ({
      ...city,
      courts: city.courts.map((court) => ({
        ...court,
        forums: court.forums.map((f) =>
          f.code === forum().code
            ? { ...f, latestParse: { status: 'degraded' as const, at, hallsUnreadable: ['7'] } }
            : f,
        ),
      })),
    })),
  };
}

const meta = {
  title: 'Courts/ForumList',
  component: ForumList,
  args: { index: sampleIndex(), slug: 'demo' },
} satisfies Meta<typeof ForumList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('grid')).toBeVisible();
    await expect(canvasElement.querySelectorAll('[data-planned-forum]')).toHaveLength(3);
  },
};

export const WithDegradedForum: Story = {
  args: { index: degradedIndex() },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-forum-banner="degraded"]')).not.toBeNull();
  },
};

export const PlannedOnly: Story = {
  args: { index: { cities: [], disabled: sampleIndex().disabled } },
};

export const Empty: Story = {
  args: { index: { cities: [], disabled: [] } },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('grid')).toBeNull();
  },
};

export const Filtered: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('searchbox'), 'karnataka');
    await expect(canvas.queryByRole('heading', { name: 'Chennai' })).toBeNull();
  },
};

export const NoMatch: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(canvas.getByRole('searchbox'), 'tribunal of nowhere');
    await expect(canvasElement.querySelector('[data-forum-no-match]')).not.toBeNull();
  },
};

/** One tab stop for the grid; arrows, Home and End move between cards. */
export const KeyboardModel: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('searchbox'));
    await userEvent.tab();
    const cards = canvas
      .getAllByRole('gridcell')
      .map((cell) => cell.querySelector<HTMLAnchorElement>('a[href^="/w/"]'));
    await expect(cards[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(cards[1]).toHaveFocus();
    await userEvent.keyboard('{End}');
    await expect(cards.at(-1)).toHaveFocus();
    await userEvent.keyboard('{Home}');
    await expect(cards[0]).toHaveFocus();
  },
};

export const LoadError: Story = {
  render: () => <CourtsLoadError />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button')).toBeVisible();
  },
};

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
