// check-stories: n/a Hover, FocusVisible, Active, Disabled, Invalid, WithIcon, LongText, RtlNeutral, Tamil, Kannada (state coverage is the Empty, Loading, ErrorState, Offline and Denied stories; no icon, RTL or per-script variants)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { SourceText } from './source-text';

const meta = {
  title: 'Patterns/Outcome/SourceText',
  component: SourceText,
  args: {
    text: 'Adjourned to 10 April for reply. File the reply in two weeks.',
    spans: [{ start: 0, end: 25 }],
    language: 'en',
    languageLabel: 'Original language: English',
  },
} satisfies Meta<typeof SourceText>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The cited span is marked; the text is shown as spoken, with no translation. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Adjourned to 10 April for reply')).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll('mark')).toHaveLength(1);
    await expect(canvas.getByText('Original language: English')).toBeVisible();
  },
};

export const Empty: Story = {
  args: { text: '', spans: [] },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('mark')).toHaveLength(0);
  },
};

export const Loading: Story = {
  args: { spans: [] },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('mark')).toHaveLength(0);
  },
};

export const ErrorState: Story = {
  args: { spans: [{ start: 500, end: 600 }] },
  play: async ({ canvasElement }) => {
    // A span outside the text is ignored, never rendered.
    await expect(canvasElement.querySelectorAll('mark')).toHaveLength(0);
  },
};

export const Offline: Story = {
  args: {
    language: 'ta',
    languageLabel: 'Original language: Tamil',
    text: 'அடுத்த விசாரணை ஏப்ரல் 10',
    spans: [{ start: 0, end: 5 }],
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('p[lang="ta"]')).not.toBeNull();
  },
};

export const Denied: Story = {
  args: {
    language: 'kn',
    languageLabel: 'Original language: Kannada',
    text: 'ಮುಂದಿನ ವಿಚಾರಣೆ',
    spans: [],
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('p[lang="kn"]')).not.toBeNull();
  },
};
