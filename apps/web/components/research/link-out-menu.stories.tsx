// Research link-out menu (#80): the closed trigger and the empty state.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { LinkOutMenu } from './link-out-menu.tsx';

const meta = {
  title: 'Research/LinkOutMenu',
  component: LinkOutMenu,
} satisfies Meta<typeof LinkOutMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithLinks: Story = {
  args: {
    links: [
      {
        providerKey: 'indian-kanoon',
        label: 'Indian Kanoon',
        url: 'https://indiankanoon.org/search/?formInput=section%2034',
        host: 'indiankanoon.org',
      },
    ],
  },
};

export const NoLinks: Story = { args: { links: [] } };
