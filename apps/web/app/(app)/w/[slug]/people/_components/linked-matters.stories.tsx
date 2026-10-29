// Linked matters (#849, #82 part 3): the matters a client is linked to on the detail page, each
// with its relation; the empty list; Tamil and Kannada matter titles.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { LinkedMatters, type LinkedMatterView } from './linked-matters.tsx';

const matter = (
  n: number,
  title: string,
  relation: LinkedMatterView['relation'],
): LinkedMatterView => ({
  matterId: `00000000-0000-4000-8000-0000000b00${String(n).padStart(2, '0')}`,
  title,
  relation,
  href: `/w/chennai-solo/matters/00000000-0000-4000-8000-0000000b00${String(n).padStart(2, '0')}`,
});

const meta = {
  title: 'People/LinkedMatters',
  component: LinkedMatters,
  args: {
    matters: [
      matter(1, 'Murugesan v. Fictional Housing Board', 'represents'),
      matter(2, 'Murugesan estate partition', 'instructed_by'),
    ],
  },
} satisfies Meta<typeof LinkedMatters>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithMatters: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole('link', { name: 'Murugesan v. Fictional Housing Board' }),
    ).toBeVisible();
    await expect(canvas.getAllByRole('listitem')).toHaveLength(2);
  },
};

export const Empty: Story = {
  args: { matters: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Not linked to a matter you can see.')).toBeVisible();
  },
};

export const Tamil: Story = {
  args: { matters: [matter(3, 'முருகன் எதிர் தமிழ்நாடு அரசு', 'represents')] },
  globals: { locale: 'ta' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'முருகன் எதிர் தமிழ்நாடு அரசு' })).toBeVisible();
  },
};

export const Kannada: Story = {
  args: { matters: [matter(4, 'ಗೌಡ ಮತ್ತು ಕರ್ನಾಟಕ ಸರ್ಕಾರ', 'instructed_by')] },
  globals: { locale: 'kn' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'ಗೌಡ ಮತ್ತು ಕರ್ನಾಟಕ ಸರ್ಕಾರ' })).toBeVisible();
  },
};
