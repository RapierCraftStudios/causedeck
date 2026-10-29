// Open Graph image for a marketing page (#91): the page title under the product name, rendered at
// build time with next/og's bundled font (no remote fetch), like app/opengraph-image.tsx.
import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 };

export function ogImage(title: string, subtitle: string): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: 80,
        background: '#faf9f6',
        color: '#1a1a1a',
      }}
    >
      <div style={{ fontSize: 40, color: '#4a4a4a' }}>CauseDeck</div>
      <div style={{ fontSize: 88, fontWeight: 700, marginTop: 16 }}>{title}</div>
      <div style={{ fontSize: 36, marginTop: 24 }}>{subtitle}</div>
    </div>,
    OG_SIZE,
  );
}
