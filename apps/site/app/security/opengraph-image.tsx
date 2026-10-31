import { ogImage, OG_SIZE } from '../../lib/og.tsx';

export const dynamic = 'force-static';
export const alt = 'CauseDeck: Security and privacy';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return ogImage('Security and privacy', 'Data in India, India-only AI, no training on your data');
}
