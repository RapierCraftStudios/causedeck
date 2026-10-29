// A small renderer for the help articles' markdown subset (K2, #94): `##` headings, paragraphs,
// `-` lists, `**bold**` and `[text](slug)` links to other articles. It builds React elements, never
// raw HTML, so article text cannot inject markup.
import type { ReactNode } from 'react';

export interface HelpMarkdownProps {
  source: string;
  /** Opens another article. A link target that is not an article slug is shown as plain text. */
  onNavigate: (slug: string) => void;
  isArticle: (slug: string) => boolean;
}

function inline(text: string, props: HelpMarkdownProps, prefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${prefix}-${String(n++)}`;
    if (match[1] !== undefined) out.push(<strong key={key}>{match[1]}</strong>);
    else if (match[3] !== undefined && props.isArticle(match[3])) {
      const slug = match[3];
      out.push(
        <button
          key={key}
          type="button"
          className="text-accent underline underline-offset-2"
          onClick={() => {
            props.onNavigate(slug);
          }}
        >
          {match[2]}
        </button>,
      );
    } else out.push(match[2]);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function HelpMarkdown(props: HelpMarkdownProps) {
  const blocks = props.source.split(/\n{2,}/).map((block) => block.trim());
  return (
    <div className="flex flex-col gap-3 text-sm leading-6">
      {blocks.map((block, at) => {
        const key = `b${String(at)}`;
        if (block.startsWith('## ')) {
          return (
            <h3 key={key} className="font-sans text-base font-semibold">
              {inline(block.slice(3), props, key)}
            </h3>
          );
        }
        const lines = block.split('\n');
        if (lines.every((line) => line.startsWith('- '))) {
          return (
            <ul key={key} className="flex list-disc flex-col gap-1 ps-5">
              {lines.map((line, i) => (
                <li key={`${key}-${String(i)}`}>
                  {inline(line.slice(2), props, `${key}-${String(i)}`)}
                </li>
              ))}
            </ul>
          );
        }
        return <p key={key}>{inline(block.replace(/\n/g, ' '), props, key)}</p>;
      })}
    </div>
  );
}
