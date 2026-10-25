// Forum tabs (#400): Halls, Adapter and Links (and Rosters when the forum has them), the current
// one marked from the pathname (mocked through `parameters.nextjs.navigation`).
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { forumTabHref, ForumTabs, type ForumTab } from './forum-tabs.tsx';

const SLUG = 'demo';
const CODE = 'in.tn.madras-hc.principal.appellate';
const ROSTERS = `/w/${SLUG}/courts/${CODE}/rosters`;

const at = (tab: ForumTab) => ({
  nextjs: { navigation: { pathname: tab === 'rosters' ? ROSTERS : forumTabHref(SLUG, CODE, tab) } },
});

/** The tab marked `aria-current="page"` is `tab`. */
const currentIs = (tab: ForumTab) =>
  async function play({ canvasElement }: { canvasElement: HTMLElement }) {
    await expect(canvasElement.querySelector('[aria-current="page"]')).toHaveAttribute(
      'data-forum-tab',
      tab,
    );
  };

const meta = {
  title: 'Courts/ForumTabs',
  component: ForumTabs,
  args: { slug: SLUG, code: CODE },
} satisfies Meta<typeof ForumTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Halls: Story = { parameters: at('halls'), play: currentIs('halls') };

export const Adapter: Story = { parameters: at('adapter'), play: currentIs('adapter') };

export const Links: Story = { parameters: at('links'), play: currentIs('links') };

export const WithRosters: Story = {
  args: { rostersHref: ROSTERS },
  parameters: at('rosters'),
  play: currentIs('rosters'),
};

export const FocusVisible: Story = {
  parameters: at('halls'),
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getAllByRole('link')[0]).toHaveFocus();
  },
};

export const Tamil: Story = { parameters: at('halls'), globals: { locale: 'ta' } };

export const Kannada: Story = { parameters: at('adapter'), globals: { locale: 'kn' } };
