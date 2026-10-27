// The studio's precedent picker (#904). Fictional data only.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { PrecedentPicker, type PrecedentPassage } from './precedent-picker.tsx';

const passages: PrecedentPassage[] = [
  {
    passageId: 'p1',
    text: 'It is therefore prayed that this Hon’ble Court may be pleased to grant an interim stay of the impugned order (fictional).',
    kind: 'prayer',
    courtId: null,
    language: 'en',
    sourceDraftVersionId: 'v1',
    anchorId: 'b.4',
    score: 85,
    reasons: [
      { code: 'kind', text: 'Same kind of passage (prayer)' },
      { code: 'language', text: 'Same language (en)' },
    ],
  },
  {
    passageId: 'p2',
    text: 'The petitioner has no other efficacious remedy (fictional).',
    kind: 'ground',
    courtId: null,
    language: 'en',
    sourceDraftVersionId: 'v1',
    anchorId: 'b.7',
    score: 30,
    reasons: [{ code: 'language', text: 'Same language (en)' }],
  },
];

const meta = {
  title: 'Drafting/PrecedentPicker',
  component: PrecedentPicker,
  args: { passages, status: 'ready', selectedBlock: 'b.3', onInsert: fn(), onRetry: fn() },
} satisfies Meta<typeof PrecedentPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ranked: Story = {};
export const Empty: Story = { args: { passages: [] } };
export const Loading: Story = { args: { status: 'loading', passages: [] } };
export const ErrorState: Story = { args: { status: 'error', passages: [] } };
export const Offline: Story = { args: { status: 'offline', passages: [] } };
export const PermissionDenied: Story = { args: { status: 'denied', passages: [] } };
export const NoBlockSelected: Story = { args: { selectedBlock: undefined } };
export const InsertDisabled: Story = { args: { disabled: true } };
