import type { ComponentProps } from 'react';

import { ProvenanceChip } from '../provenance-chip/provenance-chip';
import type { ProvenanceLabels } from '../provenance-chip/provenance-popover';
import type { ProvenanceKind, ProvenanceSource, ProvenanceState } from '../types';

/** The provenance fields of a `Brief` line (`@causedeck/validators/brief`), structurally. */
export interface SourcedLine {
  source_type: ProvenanceKind;
  source_ref: string | null;
  anchor_id: string | null;
  confidence: number | null;
  confirmation_state: 'proposed' | 'confirmed' | 'auto_applied' | 'corrected';
  page_no?: number | null;
  quote?: string | null;
}

/** A non-manual line must cite an anchor or a source reference: no provenance, no line. */
export function hasLineProvenance(
  line: Pick<SourcedLine, 'source_type' | 'source_ref' | 'anchor_id'>,
) {
  return line.source_type === 'manual' || line.anchor_id !== null || line.source_ref !== null;
}

/** Throws for a line without provenance, so an unsourced statement can never be rendered. */
export function assertProvenance(
  line: Pick<SourcedLine, 'source_type' | 'source_ref' | 'anchor_id'>,
) {
  if (!hasLineProvenance(line)) {
    throw new Error('A brief line needs an anchor or a source reference unless it is manual');
  }
}

const STATES: Record<SourcedLine['confirmation_state'], ProvenanceState> = {
  proposed: 'proposed',
  confirmed: 'confirmed',
  auto_applied: 'confirmed',
  corrected: 'edited',
};

/** The short footnote printed instead of the chip: 'Order of 12 Aug, p. 3'. */
export function footnoteText(label: string, page: number | null | undefined): string {
  return page == null ? label : `${label}, p. ${String(page)}`;
}

export interface ProvenanceLinkProps extends Omit<ComponentProps<'span'>, 'children'> {
  line: SourcedLine;
  /** Names the source: 'Order of 12 Aug'. */
  sourceLabel: string;
  documentTitle?: string | undefined;
  onOpenSource?: (() => void) | undefined;
  labels?: Partial<ProvenanceLabels> | undefined;
  viewOnly?: boolean | undefined;
  offline?: boolean | undefined;
}

/**
 * The Provenance Chip of one brief line. On screen it is the chip and its popover; in print the chip
 * is replaced by a short footnote text and the popover never prints.
 */
export function ProvenanceLink({
  line,
  sourceLabel,
  documentTitle,
  onOpenSource,
  labels,
  viewOnly,
  offline,
  ...rest
}: ProvenanceLinkProps) {
  assertProvenance(line);
  const source: ProvenanceSource = {
    kind: line.source_type,
    label: sourceLabel,
    state: STATES[line.confirmation_state],
    ...(line.quote ? { quote: line.quote } : {}),
    ...(line.page_no ? { page: line.page_no } : {}),
    ...(line.anchor_id ? { anchorId: line.anchor_id } : {}),
    ...(line.confidence === null ? {} : { confidence: line.confidence }),
  };
  const anchor =
    line.quote && line.page_no
      ? {
          id: line.anchor_id ?? 'source',
          documentTitle: documentTitle ?? sourceLabel,
          quote: line.quote,
          page: line.page_no,
        }
      : undefined;
  return (
    <span data-slot="provenance-link" {...rest}>
      <span className="print:hidden">
        <ProvenanceChip
          source={source}
          anchor={anchor}
          onOpenSource={onOpenSource}
          viewOnly={viewOnly}
          offline={offline}
          labels={labels}
        />
      </span>
      <span data-slot="provenance-footnote" className="hidden text-[0.85em] print:inline">
        {`[${footnoteText(sourceLabel, line.page_no)}]`}
      </span>
    </span>
  );
}
