'use client';
// The first step of the WhatsApp import (#527): what kind of chat is it. Only an internal chat goes
// on. A client conversation, or `not sure`, stops here: no file is read and nothing leaves the browser.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { ShieldAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';

export type ChatChoice = 'internal' | 'client' | 'unsure';

const CHOICES = ['internal', 'client', 'unsure'] as const;

export function ChatTypeStep({ onInternal }: { onInternal: () => void }) {
  const t = useTranslations('whatsappImport.chatType');
  const name = useId();
  const [choice, setChoice] = useState<ChatChoice | null>(null);
  const [stopped, setStopped] = useState(false);

  if (stopped) {
    return (
      <Alert tone="warning" icon={<ShieldAlert />} data-pattern-state="client-stop">
        <p className="text-ink font-medium">{t('stopTitle')}</p>
        <p className="text-sm">{t('stopBody')}</p>
        <Button
          className="mt-3"
          variant="outline"
          size="sm"
          onClick={() => {
            setStopped(false);
            setChoice(null);
          }}
        >
          {t('startOver')}
        </Button>
      </Alert>
    );
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (choice === 'internal') onInternal();
        else if (choice !== null) setStopped(true);
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="text-ink mb-1 text-sm font-medium">{t('legend')}</legend>
        {CHOICES.map((value) => (
          <label
            key={value}
            className="border-line flex cursor-pointer items-start gap-3 rounded-lg border p-3"
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={choice === value}
              onChange={() => {
                setChoice(value);
              }}
              className="accent-accent mt-1"
            />
            <span className="grid gap-0.5">
              <span className="text-ink text-sm font-medium">{t(value)}</span>
              <span className="text-ink-muted text-xs">{t(`${value}Hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <Button type="submit" disabled={choice === null}>
          {t('continue')}
        </Button>
      </div>
    </form>
  );
}
