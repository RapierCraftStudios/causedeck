import { COMPONENT_LABELS, type ComponentId, type ComponentState } from '../../lib/status/model.ts';
import { STATE_LABELS } from '../../lib/status/format.ts';

import { StatusIcon } from './overall-banner.tsx';

interface Props {
  id: ComponentId;
  status: ComponentState;
}

/** The name comes from our own copy by id; the snapshot's free text is not rendered. */
export function ComponentRow({ id, status }: Props) {
  return (
    <li
      data-state={status}
      className="border-line flex items-center justify-between gap-4 border-b py-3 last:border-b-0"
    >
      <span className="text-ink">{COMPONENT_LABELS[id]}</span>
      <span className="text-ink flex items-center gap-2 text-sm font-medium">
        <StatusIcon state={status} />
        {STATE_LABELS[status]}
      </span>
    </li>
  );
}
