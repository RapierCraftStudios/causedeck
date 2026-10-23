// `new_matter`: the title of the matter the capture would open.
import { str, type KindDescriptor } from './types.ts';

export const newMatter: KindDescriptor = {
  fields: [{ key: 'title', label: 'title', type: 'text' }],
  text: (payload) => str(payload, 'title') ?? '',
  render: (payload) => <span className="font-serif text-lg">{str(payload, 'title')}</span>,
};
