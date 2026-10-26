'use client';

// The drafting studio's block-tree editor (#827). Loaded with `next/dynamic` from studio.tsx so it
// stays out of the route's initial JS. Headings and paragraphs are text areas in the editorial
// serif; a slot is an underlined, selectable fact (the facts panel inserts into the selected one);
// a narrative block carries a left rule and an AI-drafted marker that goes away on the first edit,
// which reports a `{blockKey, before, after}` diff. `[[missing: …]]` markers are flagged with
// warning text, not colour alone.
import type { Block } from '@causedeck/validators/drafting';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import {
  editBlockText,
  hasMissing,
  splitMissing,
  type EditDiff,
} from '../../lib/drafting/blocks-edit.ts';

export interface DraftEditorProps {
  blocks: readonly Block[];
  /** Resolved slot values by block key (`[[missing: …]]` when the fact is unknown). */
  slotValues?: Readonly<Record<string, string>>;
  /** Model-written text by narrative block key, when there is any. */
  aiTexts?: Readonly<Record<string, string>>;
  selectedSlot?: string | undefined;
  readOnly?: boolean;
  onSelectSlot?: (key: string | undefined) => void;
  onChange: (blocks: Block[], diff?: EditDiff) => void;
}

const textClasses =
  'w-full resize-none bg-transparent font-serif leading-relaxed text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-sm';

function Marked({ text }: { text: string }) {
  const t = useTranslations('drafting.editor');
  if (!hasMissing(text)) return null;
  return (
    <p role="note" className="text-warn mt-1 font-sans text-sm">
      {splitMissing(text).map((part, i) =>
        part.missing ? (
          <mark key={i} className="bg-warn-subtle text-warn rounded-sm px-1">
            {t('missing', { name: part.text.replace(/^\[\[missing:?\s*|\]\]$/g, '') })}
          </mark>
        ) : null,
      )}
    </p>
  );
}

export function DraftEditor({
  blocks,
  slotValues = {},
  aiTexts = {},
  selectedSlot,
  readOnly = false,
  onSelectSlot,
  onChange,
}: DraftEditorProps) {
  const t = useTranslations('drafting.editor');
  const ta = useTranslations('drafting.aiDrafted');

  function edit(key: string, text: string, ai?: string) {
    const result = editBlockText(blocks, key, text, ai);
    onChange(result.blocks, result.diff);
  }

  function render(list: readonly Block[], prefix: string): ReactNode {
    return list.map((block, index) => {
      const path = `${prefix}.${String(index)}`;
      const key = block.id ?? path;
      switch (block.type) {
        case 'heading':
          return (
            <textarea
              key={key}
              data-block-key={key}
              aria-label={t('label')}
              readOnly={readOnly}
              rows={1}
              value={block.text}
              onChange={(e) => {
                edit(key, e.target.value);
              }}
              className={`${textClasses} text-2xl font-semibold`}
            />
          );
        case 'paragraph':
        case 'narrative': {
          // One shape for both, so the first edit of AI text keeps the caret in the same field.
          const ai = block.type === 'narrative' ? (aiTexts[key] ?? '') : undefined;
          const text = block.type === 'paragraph' ? block.text : (ai ?? '');
          return (
            <div
              key={key}
              className={block.type === 'narrative' ? 'border-seal border-s-2 ps-3' : undefined}
            >
              {block.type === 'narrative' ? (
                <p className="text-ink-muted font-sans text-xs">
                  {t('narrative', { prompt: block.prompt })}
                  {text === '' ? null : (
                    <span
                      data-slot="ai-drafted-marker"
                      className="bg-seal-subtle text-ink ms-2 rounded-sm px-1"
                    >
                      {ta('label')}
                    </span>
                  )}
                </p>
              ) : null}
              <textarea
                data-block-key={key}
                aria-label={t('label')}
                readOnly={readOnly}
                rows={Math.max(2, Math.ceil(text.length / 80))}
                value={text}
                onChange={(e) => {
                  edit(key, e.target.value, ai);
                }}
                className={`${textClasses} text-base`}
              />
              <Marked text={text} />
            </div>
          );
        }
        case 'slot': {
          const value = slotValues[key] ?? '';
          const label = block.label ?? block.resolver;
          return (
            <div key={key}>
              <button
                type="button"
                data-block-key={key}
                aria-pressed={selectedSlot === key}
                aria-label={t('slot', { label })}
                onClick={() => {
                  onSelectSlot?.(selectedSlot === key ? undefined : key);
                }}
                className="text-ink focus-visible:ring-focus aria-pressed:bg-seal-subtle rounded-sm font-serif underline decoration-dotted underline-offset-4 focus-visible:ring-2"
              >
                {value === '' ? label : value}
              </button>
              <Marked text={value} />
            </div>
          );
        }
        case 'section':
          return (
            <section key={key} className="flex flex-col gap-3">
              {block.title === undefined ? null : (
                <h2 className="font-serif text-xl font-semibold">{block.title}</h2>
              )}
              {render(block.children, path)}
            </section>
          );
        case 'list':
          return (
            <div key={key} className="flex flex-col gap-2 ps-4">
              {render(block.children, path)}
            </div>
          );
        case 'page_break':
          return <hr key={key} className="border-line" />;
      }
    });
  }

  return (
    <div data-slot="draft-editor" className="flex flex-col gap-4">
      {render(blocks, 'b')}
    </div>
  );
}

export default DraftEditor;
