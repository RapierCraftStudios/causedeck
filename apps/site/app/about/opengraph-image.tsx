import { ogImage, OG_SIZE } from '../../lib/og.tsx';

export const dynamic = 'force-static';
export const alt = 'CauseDeck: About CauseDeck';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return ogImage('About CauseDeck', 'Software for advocates, not legal services');
}
