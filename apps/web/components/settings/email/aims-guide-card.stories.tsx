// The AIMS setup guide card (#54): how to forward from the court's mail service.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { AimsGuideCard } from './aims-guide-card.tsx';

const meta = {
  title: 'Settings/Email/AimsGuideCard',
  component: AimsGuideCard,
} satisfies Meta<typeof AimsGuideCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Tamil: Story = { globals: { locale: 'ta' } };
