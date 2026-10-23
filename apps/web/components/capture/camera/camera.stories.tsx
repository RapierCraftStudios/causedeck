// Camera capture (#52): a story per state (viewfinder, crop, strip, review, permission denied) with
// fictional pages, so the visual baselines cover them in both themes at 360, 768 and 1280.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { createRef } from 'react';
import { fn } from 'storybook/test';

import { defaultCorners } from '../../../lib/capture/camera/deskew.ts';

import { CameraDenied } from './camera-sheet.tsx';
import { CameraViewfinder } from './camera-viewfinder.tsx';
import { CropEditor } from './crop-editor.tsx';
import { PageStrip, type StripPage } from './page-strip.tsx';
import { PhotoReview } from './photo-review.tsx';

/** A fictional diary page as an inline SVG, so no file is fetched. */
function pageSvg(n: number): string {
  const lines = [
    `Diary page ${String(n)}`,
    'WP 1234/2026 - arguments heard',
    'Next date 12 Oct 2026',
  ]
    .map(
      (text, i) =>
        `<text x="40" y="${String(90 + i * 60)}" font-size="28" fill="#222">${text}</text>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#fbf8ef"/>${lines}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const pages: StripPage[] = [1, 2, 3].map((n) => ({ id: n, url: pageSvg(n) }));

const meta = {
  title: 'Capture/Camera',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Viewfinder: Story = {
  render: () => (
    <CameraViewfinder
      stream={null}
      videoRef={createRef<HTMLVideoElement>()}
      count={2}
      hint={null}
      strip={<PageStrip pages={pages.slice(0, 2)} compact />}
      flashSupported={false}
      flashOn={false}
      onFlash={fn()}
      onShutter={fn()}
      onDone={fn()}
      onClose={fn()}
    />
  ),
};

export const Crop: Story = {
  render: () => (
    <CropEditor
      src={pageSvg(1)}
      width={600}
      height={800}
      corners={defaultCorners(600, 800, 0.08)}
      suggested={defaultCorners(600, 800, 0.08)}
      enhance={false}
      onEnhance={fn()}
      onChange={fn()}
      onApply={fn()}
      onCancel={fn()}
    />
  ),
};

export const Strip: Story = {
  render: () => (
    <div className="p-4">
      <PageStrip pages={pages} onMove={fn()} onRetake={fn()} onDelete={fn()} />
    </div>
  ),
};

export const Review: Story = {
  render: () => (
    <PhotoReview
      pages={pages}
      keepOriginal={false}
      onKeepOriginal={fn()}
      offline={false}
      busy={false}
      onMove={fn()}
      onRetake={fn()}
      onDelete={fn()}
      onUpload={fn()}
      onBack={fn()}
      onDiscard={fn()}
    />
  ),
};

export const PermissionDenied: Story = {
  render: () => <CameraDenied count={0} onChoose={fn()} onReview={fn()} />,
};
