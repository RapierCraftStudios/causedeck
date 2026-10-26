/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
'use client';

import { Button } from '@causedeck/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@causedeck/ui/sheet';
import { SourceText, type SourceSpan } from '@causedeck/ui/patterns';
import type { OutcomeProposal } from '@causedeck/validators/hearing-outcome';
import { useTranslations } from 'next-intl';

interface TranscriptDrawerProps {
  /** The transcript as the cited excerpts joined in order, each excerpt one highlighted span. */
  excerpts: readonly string[];
  language: OutcomeProposal['language'];
}

/** The transcript in its original language with the cited spans marked; it makes no translation claim. */
export function TranscriptDrawer({ excerpts, language }: TranscriptDrawerProps) {
  const t = useTranslations('outcome.transcript');
  const spans: SourceSpan[] = [];
  let text = '';
  for (const excerpt of excerpts) {
    if (text !== '') text += '\n\n';
    spans.push({ start: text.length, end: text.length + excerpt.length });
    text += excerpt;
  }
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline">
          {t('open')}
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>
            {t('language', { language: t(`languages.${language}`) })}
          </SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto p-4">
          {text === '' ? (
            <p className="text-muted-foreground text-sm">{t('empty')}</p>
          ) : (
            <SourceText
              text={text}
              spans={spans}
              language={language}
              languageLabel={t('language', { language: t(`languages.${language}`) })}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
