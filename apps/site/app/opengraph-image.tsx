import { ImageResponse } from 'next/og';

export const dynamic = 'force-static';
export const alt = 'CauseDeck: software for advocates';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Rendered once at build time with next/og's bundled font; no remote fetch.
export default function OpenGraphImage() {
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
      <div style={{ fontSize: 96, fontWeight: 700 }}>CauseDeck</div>
      <div style={{ fontSize: 40, marginTop: 24 }}>Software for advocates</div>
    </div>,
    size,
  );
}
