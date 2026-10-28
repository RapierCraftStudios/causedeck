'use client';

// The drafting studio's block-tree editor (#827). Loaded with `next/dynamic` from studio.tsx so it
// stays out of the route's initial JS. Headings and paragraphs are text areas in the editorial
// serif; a slot is an underlined, selectable fact (the facts panel inserts into the selected one);
// a narrative block carries a left rule and an AI-drafted marker that goes away on the first edit,
// which reports a `{blockKey, before, after}` diff. `[[missing: …]]` markers are flagged with
// warning text, not colour alone.
import type { LiveFactVerdict } from '@causedeck/core/drafting';
import { FactSquiggle } from '@causedeck/ui/patterns';
import type { Block } from '@causedeck/validators/drafting';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import {
  editBlockText,
  hasMissing,
  splitMissing,
  type EditDiff,
} from '../../lib/drafting/blocks-edit.ts';
import { fixText, useFactLabels } from '../../lib/drafting/use-fact-check.ts';

/** Live fact-check wiring (#916): verdicts for the current text and what a click may do. */
export interface EditorFacts {
  verdicts: readonly LiveFactVerdict[];
  /** Click-only; the host applies the edit and keeps it undoable. */
  onFix?: ((verdict: LiveFactVerdict) => void) | undefined;
  /** The matter-level decisions need a saved draft version; surfaces without one omit them. */
  onIgnoreForMatter?: ((verdict: LiveFactVerdict) => void) | undefined;
  onMarkAssertion?: ((verdict: LiveFactVerdict) => void) | undefined;
}

export interface DraftEditorProps {
  blocks: readonly Block[];
  /** Resolved slot values by block key (`[[missing: …]]` when the fact is unknown). */
  slotValues?: Readonly<Record<string, string>>;
  /** Model-written text by narrative block key, when there is any. */
  aiTexts?: Readonly<Record<string, string>>;
  selectedSlot?: string | undefined;
  readOnly?: boolean;
  onSelectSlot?: (key: string | undefined) => void;
  /** Verdicts to underline in a read-along line under each block's text area. */
  facts?: EditorFacts | undefined;
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

/**
 * The block's text with each open claim issue underlined. A text area cannot hold inline markup, so
 * the annotated line sits under it; a match, an ignored or an asserted claim carries no underline.
 */
export function FactLine({
  text,
  verdicts,
  facts,
}: {
  text: string;
  verdicts: readonly LiveFactVerdict[];
  facts: EditorFacts;
}) {
  const labels = useFactLabels();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const issues = verdicts
    .filter(
      (v) =>
        v.status !== 'match' &&
        v.resolution === 'open' &&
        !dismissed.has(v.claimId) &&
        v.end <= text.length,
    )
    .sort((a, b) => a.start - b.start);
  if (issues.length === 0) return null;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const v of issues) {
    if (v.start < at) continue;
    parts.push(text.slice(at, v.start));
    const fix = fixText(v);
    parts.push(
      <FactSquiggle
        key={v.claimId}
        status={v.status}
        labels={labels}
        source={{ document: v.anchor.document, page: v.anchor.page, quote: v.anchor.quote }}
        onFix={
          fix === null || facts.onFix === undefined
            ? undefined
            : () => {
                facts.onFix?.(v);
              }
        }
        onIgnore={() => {
          setDismissed((prev) => new Set(prev).add(v.claimId));
        }}
        onIgnoreForMatter={
          facts.onIgnoreForMatter === undefined
            ? undefined
            : () => {
                facts.onIgnoreForMatter?.(v);
              }
        }
        onMarkAssertion={
          facts.onMarkAssertion === undefined
            ? undefined
            : () => {
                facts.onMarkAssertion?.(v);
              }
        }
      >
        {text.slice(v.start, v.end)}
      </FactSquiggle>,
    );
    at = v.end;
  }
  parts.push(text.slice(at));
  return (
    <p
      data-slot="fact-line"
      className="text-ink-muted mt-1 border-s-2 ps-2 font-serif text-sm leading-relaxed"
    >
      {parts.map((part, i) => (
        <span key={i}>{part}</span>
      ))}
    </p>
  );
}

export function DraftEditor({
  blocks,
  slotValues = {},
  aiTexts = {},
  selectedSlot,
  readOnly = false,
  facts,
  onSelectSlot,
  onChange,
}: DraftEditorProps) {
  const t = useTranslations('drafting.editor');
  const ta = useTranslations('drafting.aiDrafted');

  const factLine = (key: string, text: string): ReactNode =>
    facts === undefined ? null : (
      <FactLine
        text={text}
        verdicts={facts.verdicts.filter((v) => v.blockKey === key)}
        facts={facts}
      />
    );

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
            <div key={key}>
              <textarea
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
              {factLine(key, block.text)}
            </div>
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
              {factLine(key, text)}
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
                aria-label={`${value === '' ? label : value} (${t('slot', { label })})`}
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
