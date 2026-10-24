// eCourts portal option lists (#634): the state, district, court-complex (establishment) and case
// type drop-downs are `<select>` elements of `<option value="code">Label</option>`. Pure and total:
// unreadable markup gives no lists. Placeholder options (empty value, `Select ...`) are skipped.
import { parse, type DefaultTreeAdapterTypes } from 'parse5';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

export interface OptionEntry {
  code: string;
  label: string;
}

const isElement = (node: Node): node is Element => 'tagName' in node;
const childrenOf = (node: Node): Node[] => ('childNodes' in node ? node.childNodes : []);
const attr = (node: Element, name: string) => node.attrs.find((a) => a.name === name)?.value;
const textOf = (node: Node): string =>
  node.nodeName === '#text' && 'value' in node ? node.value : childrenOf(node).map(textOf).join('');
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Option lists keyed by the `id` (else `name`) of their `<select>`. */
export function parseOptionLists(html: string): Record<string, OptionEntry[]> {
  const lists: Record<string, OptionEntry[]> = {};
  const visit = (node: Node): void => {
    if (isElement(node) && node.tagName === 'select') {
      const key = attr(node, 'id') ?? attr(node, 'name');
      const entries: OptionEntry[] = [];
      const collect = (parent: Node): void => {
        for (const child of childrenOf(parent)) {
          if (!isElement(child)) continue;
          if (child.tagName === 'option') {
            const code = (attr(child, 'value') ?? '').trim();
            const label = collapse(textOf(child));
            if (code !== '' && label !== '' && !/^select\b/i.test(label)) {
              entries.push({ code, label });
            }
          } else collect(child);
        }
      };
      collect(node);
      if (key !== undefined && key !== '') lists[key] = entries;
      return;
    }
    for (const child of childrenOf(node)) visit(child);
  };
  try {
    visit(parse(html));
  } catch {
    // unreadable markup: no lists
  }
  return lists;
}

/** The entries of one drop-down (`parseOptionLists(html)[id]`), `[]` when it is absent. */
export function parseOptionList(html: string, id: string): OptionEntry[] {
  return parseOptionLists(html)[id] ?? [];
}
