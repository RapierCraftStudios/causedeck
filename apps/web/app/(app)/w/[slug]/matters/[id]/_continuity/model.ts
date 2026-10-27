// Pure mappers from the continuity payloads to the UI pattern props (#71). No strings of its own:
// labels come in from the catalog.
import type { ChangeCardGroup, HandoverSectionView } from '@causedeck/ui/patterns';
import type { BriefLine, ChangeSummary, HandoverBody } from '@causedeck/validators';

/** `Order, p. 2` style detail: the source type and the page when the line has an anchor. */
export function lineDetail(
  line: Pick<BriefLine, 'source_type'> & { page_no?: number | null },
): string {
  const page = line.page_no == null ? '' : `, p. ${String(line.page_no)}`;
  return `${line.source_type.replaceAll('_', ' ')}${page}`;
}

export interface SectionLabels {
  sections: Record<string, string>;
  noneRecorded: string;
  overdue: string;
}

/** The handover sections in the order of the five standard questions, then the rest. */
export function handoverSections(body: HandoverBody, labels: SectionLabels): HandoverSectionView[] {
  const lineItem = (line: BriefLine, id: string) => ({
    id,
    text: line.text,
    detail: lineDetail(line),
    flag: line.label ?? undefined,
  });
  return [
    {
      id: 'where_it_stands',
      title: labels.sections.where_it_stands ?? '',
      emptyLabel: labels.noneRecorded,
      items: [
        ...(body.synopsis === null ? [] : [lineItem(body.synopsis, 'synopsis')]),
        ...body.stages.map((s) => lineItem(s.line, s.proceeding_id)),
      ],
    },
    {
      id: 'last_orders',
      title: labels.sections.last_orders ?? '',
      emptyLabel: labels.noneRecorded,
      items: body.last_orders.flatMap((o) =>
        o.lines.map((l, i) => lineItem(l, `${o.order_id}-${String(i)}`)),
      ),
    },
    {
      id: 'coming_up',
      title: labels.sections.coming_up ?? '',
      emptyLabel: labels.noneRecorded,
      items: body.coming_up.map((l) => lineItem(l.line, l.listing_id)),
    },
    {
      id: 'open_obligations',
      title: labels.sections.open_obligations ?? '',
      emptyLabel: labels.noneRecorded,
      items: body.open_obligations.map((o) => ({
        id: o.obligation_id,
        text: o.text,
        detail: lineDetail(o),
        flag: o.overdue ? labels.overdue : undefined,
      })),
    },
    {
      id: 'key_documents',
      title: labels.sections.key_documents ?? '',
      emptyLabel: labels.noneRecorded,
      items: body.key_documents.map((l, i) => lineItem(l, `doc-${String(i)}`)),
    },
    {
      id: 'open_questions',
      title: labels.sections.open_questions ?? '',
      emptyLabel: body.open_questions_label ?? labels.noneRecorded,
      items: body.open_questions.map((l, i) => lineItem(l, `q-${String(i)}`)),
    },
  ];
}

/** Day groups for the card: the kind label and the actor's name, when known, go in the detail. */
export function changeGroups(
  summary: ChangeSummary,
  kinds: Record<string, string>,
  members: Record<string, string>,
): ChangeCardGroup[] {
  return summary.groups.map((g) => ({
    day: g.day,
    items: g.items.map((item, i) => {
      const actor = item.actor_member_id === null ? undefined : members[item.actor_member_id];
      return {
        id: `${g.day}-${String(i)}`,
        text: item.line.text,
        detail: [kinds[item.kind], lineDetail(item.line), actor].filter(Boolean).join(' · '),
      };
    }),
  }));
}

/** The first-ever view shows no card. */
export const showChangeCard = (previousViewedAt: string | null): previousViewedAt is string =>
  previousViewedAt !== null;
