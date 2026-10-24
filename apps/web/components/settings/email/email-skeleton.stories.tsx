// The loading state of the email intake page (#54).
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { EmailIntakeSkeleton } from './email-skeleton.tsx';

const meta = {
  title: 'Settings/Email/EmailIntakeSkeleton',
  component: EmailIntakeSkeleton,
} satisfies Meta<typeof EmailIntakeSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};
