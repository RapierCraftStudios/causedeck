import { ogImage, OG_SIZE } from '../../lib/og.tsx';

export const dynamic = 'force-static';
export const alt = 'CauseDeck pricing';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return ogImage('Pricing', 'Software seats for advocates, in rupees');
}
