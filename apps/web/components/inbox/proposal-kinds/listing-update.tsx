// `listing_update`: the item number printed for a listing.
import { str, type KindDescriptor } from './types.ts';

export const listingUpdate: KindDescriptor = {
  fields: [{ key: 'itemNo', label: 'number', type: 'text' }],
  text: (payload) => str(payload, 'itemNo') ?? '',
  render: (payload) => <span className="tabular-nums">{str(payload, 'itemNo')}</span>,
};
