import { ogImage, OG_SIZE } from '../../lib/og.tsx';

export const dynamic = 'force-static';
export const alt = 'CauseDeck: Changelog';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return ogImage('Changelog', 'Product changes, newest first');
}
