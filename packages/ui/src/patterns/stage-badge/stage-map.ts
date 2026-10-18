import {
  CalendarDays,
  CircleCheckBig,
  CirclePause,
  ClipboardList,
  FilePlus2,
  Hash,
  Hourglass,
  Redo2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

import { LISTING_STAGES, PROCEEDING_STAGES, type Stage } from '../types';

export interface StageMeta {
  /** Plain court terms. */
  label: string;
  Icon: LucideIcon;
  /** Colour token name (`--stage-*`); the soft variant is the background. */
  token: `stage-${Stage}`;
  /** Literal utilities so Tailwind sees them. */
  classes: string;
}

export const STAGE_ORDER: readonly Stage[] = [...PROCEEDING_STAGES, ...LISTING_STAGES];

export const STAGE_MAP: Record<Stage, StageMeta> = {
  filed: {
    label: 'Filed',
    Icon: FilePlus2,
    token: 'stage-filed',
    classes: 'bg-stage-filed-soft text-stage-filed',
  },
  sr_fr: {
    label: 'SR',
    Icon: ClipboardList,
    token: 'stage-sr_fr',
    classes: 'bg-stage-sr_fr-soft text-stage-sr_fr',
  },
  defects: {
    label: 'Defects',
    Icon: TriangleAlert,
    token: 'stage-defects',
    classes: 'bg-stage-defects-soft text-stage-defects',
  },
  re_presented: {
    label: 'Re-presented',
    Icon: Redo2,
    token: 'stage-re_presented',
    classes: 'bg-stage-re_presented-soft text-stage-re_presented',
  },
  numbered: {
    label: 'Numbered',
    Icon: Hash,
    token: 'stage-numbered',
    classes: 'bg-stage-numbered-soft text-stage-numbered',
  },
  disposed: {
    label: 'Disposed',
    Icon: CircleCheckBig,
    token: 'stage-disposed',
    classes: 'bg-stage-disposed-soft text-stage-disposed',
  },
  listed: {
    label: 'Listed',
    Icon: CalendarDays,
    token: 'stage-listed',
    classes: 'bg-stage-listed-soft text-stage-listed',
  },
  reserved: {
    label: 'Reserved',
    Icon: Hourglass,
    token: 'stage-reserved',
    classes: 'bg-stage-reserved-soft text-stage-reserved',
  },
  'part-heard': {
    label: 'Part-heard',
    Icon: CirclePause,
    token: 'stage-part-heard',
    classes: 'bg-stage-part-heard-soft text-stage-part-heard',
  },
};
