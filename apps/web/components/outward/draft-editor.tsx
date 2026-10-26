'use client';
// The draft editor (#736): the lawyer's text in a serif textarea, the facts it was built from with
// their provenance on a right rail, guard warnings as plain amber notes, and the share menu. It
// never sends: the lawyer reviews, edits and shares it themselves (ADR 0045).
// Keys: Cmd/Ctrl+Enter copies, `l` cycles the language, `d` shows the changes, Esc closes.
import { Button } from '@causedeck/ui/button';
import { Textarea } from '@causedeck/ui/textarea';
import {
  LANGUAGES,
  type Audience,
  type Language,
  type ShareChannel,
} from '@causedeck/validators/outward-draft';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { diffWords, DiffView } from './diff-view.tsx';
import { LanguageSwitcher } from './language-switcher.tsx';
import { copyDraft, ShareMenu } from './share-menu.tsx';

export interface FactView {
  kind: string;
  text: string;
  confirmed: boolean;
  source: string;
}

export interface DraftView {
  id: string;
  matterId: string;
  matterTitle: string;
  audience: Audience;
  language: Language;
  body: string;
  systemBody: string;
  facts: FactView[];
  /** The memory that shaped the text: the memory key and the day it was saved. */
  memoryCitations: { key: string; date: string }[];
}

export interface DraftEditorProps {
  draft: DraftView;
  offline: boolean;
  readOnly: boolean;
  onSave: (body: string) => Promise<{ ok: boolean; warnings: string[] }>;
  onShared: (channel: ShareChannel) => Promise<boolean>;
  onLanguageChange: (language: Language) => void;
  onClose: () => void;
}

export function DraftEditor({
  draft,
  offline,
  readOnly,
  onSave,
  onShared,
  onLanguageChange,
  onClose,
}: DraftEditorProps) {
  const t = useTranslations('outward');
  const tm = useTranslations('memoryCitations');
  const memoryReason = (key: string) =>
    key === 'M2.client_update_tone'
      ? tm('draftTone')
      : key === 'M6.client_language'
        ? tm('draftLanguage')
        : tm('draftOther');
  const [body, setBody] = useState(draft.body);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showDiff, setShowDiff] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // A different draft, or a saved text, replaces what is in the box (adjusting state in render).
  const [seen, setSeen] = useState(`${draft.id}:${draft.body}`);
  if (seen !== `${draft.id}:${draft.body}`) {
    setSeen(`${draft.id}:${draft.body}`);
    setBody(draft.body);
    setWarnings([]);
  }

  const copy = () => {
    void copyDraft(body).then((ok) => {
      setAnnouncement(ok ? t('share.copied') : t('share.copyFailed'));
    });
  };
  const nextLanguage = () => {
    const next = LANGUAGES[(LANGUAGES.indexOf(draft.language) + 1) % LANGUAGES.length] ?? 'en';
    setAnnouncement(t('language.changed', { language: t(`language.${next}Name`) }));
    onLanguageChange(next);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const typing = (event.target as HTMLElement).tagName === 'TEXTAREA';
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      copy();
    } else if (event.key === 'Escape') {
      onClose();
    } else if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key === 'l' && !readOnly && !offline) nextLanguage();
      if (event.key === 'd') setShowDiff((v) => !v);
    }
  };

  return (
    <section
      ref={ref}
      aria-label={t('editor.label', { matter: draft.matterTitle })}
      data-slot="draft-editor"
      onKeyDown={onKeyDown}
      className="motion-safe:animate-fade-in grid gap-4 duration-[180ms]"
    >
      <p
        role="note"
        className="bg-surface-sunken border-line text-ink rounded-lg border px-3 py-2 text-sm"
      >
        {t('banner')}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-ink font-serif text-xl">{draft.matterTitle}</h2>
        <LanguageSwitcher
          value={draft.language}
          onChange={onLanguageChange}
          disabled={readOnly || offline}
        />
      </div>
      {warnings.length > 0 ? (
        <p role="status" className="text-warning-ink text-sm">
          {t('editor.warnings', { phrases: warnings.join(', ') })}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
        <div className="grid gap-3">
          {showDiff ? (
            <DiffView parts={diffWords(draft.systemBody, body)} />
          ) : (
            <Textarea
              aria-label={t('editor.label', { matter: draft.matterTitle })}
              lang={draft.language}
              value={body}
              readOnly={readOnly}
              rows={14}
              onChange={(event) => {
                setBody(event.target.value);
              }}
              className="text-ink font-serif leading-[1.7]"
              style={{
                fontFamily: "var(--font-serif), 'Noto Serif Tamil', 'Noto Serif Kannada', serif",
              }}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={readOnly || body === draft.body}
              className="pointer-coarse:min-h-11"
              onClick={() => {
                void onSave(body).then((result) => {
                  setWarnings(result.warnings);
                  setAnnouncement(result.ok ? t('editor.saved') : t('editor.saveFailed'));
                });
              }}
            >
              {t('editor.save')}
            </Button>
            <Button
              variant="secondary"
              aria-pressed={showDiff}
              className="pointer-coarse:min-h-11"
              onClick={() => {
                setShowDiff((v) => !v);
              }}
            >
              {t('diff.toggle')}
            </Button>
            <Button variant="ghost" className="pointer-coarse:min-h-11" onClick={onClose}>
              {t('editor.close')}
            </Button>
          </div>
        </div>
        <aside aria-label={t('editor.facts')} className="grid content-start gap-2">
          <h3 className="text-ink text-sm font-medium">{t('editor.facts')}</h3>
          {draft.facts.length === 0 ? (
            <p className="text-ink-muted text-sm">{t('editor.noFacts')}</p>
          ) : (
            <ul className="grid gap-2">
              {draft.facts.map((fact, index) => (
                <li key={index} className="border-line rounded-lg border p-2 text-sm">
                  <span className="text-ink">{fact.text}</span>
                  <span className="text-ink-muted block text-xs">{fact.source}</span>
                  <span
                    className={
                      fact.confirmed ? 'text-ink-muted text-xs' : 'text-warning-ink text-xs'
                    }
                  >
                    {fact.confirmed ? t('editor.factConfirmed') : t('editor.factToConfirm')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {draft.memoryCitations.length > 0 ? (
            <div className="grid gap-2">
              <h3 className="text-ink text-sm font-medium">{tm('draftTitle')}</h3>
              <ul className="grid gap-2">
                {draft.memoryCitations.map((c) => (
                  <li
                    key={c.key}
                    data-memory-citation
                    aria-label={tm('chipLabel', { reason: memoryReason(c.key) })}
                    className="border-line rounded-lg border p-2 text-sm"
                  >
                    <span className="text-ink">
                      {tm('usedMemory', { reason: memoryReason(c.key) })}
                    </span>
                    <span className="text-ink-muted block text-xs">
                      {tm('noteDate', { date: c.date })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
      <ShareMenu
        text={body}
        matterTitle={draft.matterTitle}
        offline={offline}
        readOnly={readOnly}
        onCopied={(ok) => {
          setAnnouncement(ok ? t('share.copied') : t('share.copyFailed'));
        }}
        onShared={async (channel) => {
          const ok = await onShared(channel);
          setAnnouncement(ok ? t('share.shared') : t('share.failed'));
        }}
      />
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
    </section>
  );
}
