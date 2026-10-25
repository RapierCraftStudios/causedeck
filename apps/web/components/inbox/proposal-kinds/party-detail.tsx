// `party_detail`: a name or contact detail for a person on the matter.
import { str, type KindDescriptor } from './types.ts';

export const partyDetail: KindDescriptor = {
  fields: [{ key: 'name', label: 'name', type: 'text' }],
  text: (payload) => str(payload, 'name') ?? '',
  render: (payload) => <span>{str(payload, 'name')}</span>,
};
