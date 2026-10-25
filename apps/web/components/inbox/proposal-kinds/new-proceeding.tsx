// `new_proceeding`: the case type and number of a proceeding to add to an existing matter.
import { num, str, type KindDescriptor, type Payload } from './types.ts';

function label(payload: Payload): string {
  const type = str(payload, 'caseType') ?? '';
  const number = str(payload, 'number');
  const year = num(payload, 'year');
  const core = number === null ? type : `${type} ${number}`.trim();
  return year === null ? core : `${core} of ${String(year)}`;
}

export const newProceeding: KindDescriptor = {
  fields: [
    { key: 'number', label: 'number', type: 'text' },
    { key: 'year', label: 'year', type: 'number' },
  ],
  text: label,
  render: (payload) => <span className="tabular-nums">{label(payload)}</span>,
};
