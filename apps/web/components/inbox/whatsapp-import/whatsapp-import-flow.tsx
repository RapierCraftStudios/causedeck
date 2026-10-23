'use client';
// The WhatsApp import flow (#527, PRD CA-6): chat type → export file → in-browser parse (Web Worker)
// → preview and selection → upload of the selected messages only. The raw file, the chat title and
// every unselected or held-back message stay in this browser (ADR 0026).
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Progress } from '@causedeck/ui/progress';
import { PatternEmptyState } from '@causedeck/ui/patterns';
import { WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { chatWarning, type ChatWarning } from '../../../lib/inbox/whatsapp-import/heuristics.ts';
import { buildPayload } from '../../../lib/inbox/whatsapp-import/payload.ts';
import { initialSelection } from '../../../lib/inbox/whatsapp-import/selection.ts';
import type { ParsedChat, ParseFailure } from '../../../lib/inbox/whatsapp-import/types.ts';
import {
  uploadWhatsAppImport,
  type WhatsAppUploadFailure,
} from '../../../lib/inbox/whatsapp-import/upload.ts';
import { parseInWorker } from '../../../lib/inbox/whatsapp-import/worker-client.ts';
import { useOnline } from '../../settings/settings-offline-banner.tsx';

import { ChatTypeStep } from './chat-type-step.tsx';
import { WhatsAppDisclosure } from './disclosure.tsx';
import { ReviewStep, type ReviewState } from './review-step.tsx';

export interface WhatsAppImportFlowProps {
  workspaceId: string;
  slug: string;
  /** The signed-in member's name, for the two-person heuristic. */
  memberName: string;
}

type Step =
  | { kind: 'type' }
  | { kind: 'file'; error?: ParseFailure }
  | { kind: 'parsing'; fraction: number }
  | { kind: 'warning'; chat: ParsedChat; warning: ChatWarning }
  | { kind: 'review'; chat: ParsedChat; state: ReviewState }
  | { kind: 'uploading'; chat: ParsedChat; state: ReviewState }
  | { kind: 'done' };

export function WhatsAppImportFlow({ workspaceId, slug, memberName }: WhatsAppImportFlowProps) {
  const t = useTranslations('whatsappImport');
  const online = useOnline();
  const [step, setStep] = useState<Step>({ kind: 'type' });
  const [failure, setFailure] = useState<WhatsAppUploadFailure | null>(null);
  const fileRef = useRef<File | null>(null);

  async function read(file: File, dateOrder?: 'dmy' | 'mdy') {
    fileRef.current = file;
    setStep({ kind: 'parsing', fraction: 0 });
    const outcome = await parseInWorker(file, {
      ...(dateOrder === undefined ? {} : { dateOrder }),
      onProgress: (fraction) => {
        setStep({ kind: 'parsing', fraction });
      },
    });
    if (!outcome.ok) {
      setStep({ kind: 'file', error: outcome.reason });
      return;
    }
    const { chat } = outcome;
    const warning = dateOrder === undefined ? chatWarning(chat.senders, memberName) : null;
    setStep(
      warning === null
        ? {
            kind: 'review',
            chat,
            state: { selected: initialSelection(chat.rows), confirmed: new Set() },
          }
        : { kind: 'warning', chat, warning },
    );
  }

  async function upload(chat: ParsedChat, state: ReviewState) {
    setFailure(null);
    setStep({ kind: 'uploading', chat, state });
    const result = await uploadWhatsAppImport(
      buildPayload(workspaceId, chat, state.selected, state.confirmed),
    );
    if (result.ok) {
      setStep({ kind: 'done' });
      return;
    }
    setFailure(result.error);
    setStep({ kind: 'review', chat, state });
  }

  return (
    <div className="grid max-w-3xl gap-5" data-route="inbox-import-whatsapp">
      {online ? null : (
        <Alert tone="warning" icon={<WifiOff />} data-pattern-state="offline">
          {t('states.offline')}
        </Alert>
      )}
      {step.kind === 'type' || step.kind === 'file' ? <WhatsAppDisclosure /> : null}

      {step.kind === 'type' ? (
        <ChatTypeStep
          onInternal={() => {
            setStep({ kind: 'file' });
          }}
        />
      ) : null}

      {step.kind === 'file' ? (
        <div className="grid gap-3">
          {step.error === undefined ? (
            <PatternEmptyState message={t('states.empty')} />
          ) : (
            <Alert tone="danger" data-pattern-state="error">
              {t(`states.error.${step.error}`)}
            </Alert>
          )}
          <label className="grid gap-1 text-sm">
            <span className="text-ink font-medium">{t('file.label')}</span>
            <span className="text-ink-muted text-xs">{t('file.hint')}</span>
            <input
              type="file"
              accept=".zip,.txt,application/zip,text/plain"
              data-slot="whatsapp-file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) void read(file);
              }}
            />
          </label>
        </div>
      ) : null}

      {step.kind === 'parsing' ? (
        <div className="grid gap-2" data-pattern-state="loading">
          <p role="status" className="text-ink text-sm">
            {t('file.progress', { percent: Math.round(step.fraction * 100) })}
          </p>
          <Progress
            aria-label={t('file.progress', { percent: Math.round(step.fraction * 100) })}
            value={Math.round(step.fraction * 100)}
          />
        </div>
      ) : null}

      {step.kind === 'warning' ? (
        <Alert tone="warning" data-pattern-state="client-warning">
          <p className="text-ink font-medium">
            {step.warning.kind === 'client_participants'
              ? t('warning.clientTitle')
              : t('warning.twoTitle')}
          </p>
          <p className="text-sm">
            {step.warning.kind === 'client_participants'
              ? t('warning.clientBody', { names: step.warning.names.join(', ') })
              : t('warning.twoBody')}
          </p>
          <div className="mt-3 flex gap-2">
            {step.warning.kind === 'two_person_non_member' ? (
              <Button
                size="sm"
                onClick={() => {
                  setStep({
                    kind: 'review',
                    chat: step.chat,
                    state: { selected: initialSelection(step.chat.rows), confirmed: new Set() },
                  });
                }}
              >
                {t('warning.confirmInternal')}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                fileRef.current = null;
                setStep({ kind: 'type' });
              }}
            >
              {t('warning.stop')}
            </Button>
          </div>
        </Alert>
      ) : null}

      {step.kind === 'review' || step.kind === 'uploading' ? (
        <>
          <ReviewStep
            chat={step.chat}
            state={step.state}
            onChange={(state) => {
              setStep({ kind: 'review', chat: step.chat, state });
            }}
            onFlipDateOrder={() => {
              const file = fileRef.current;
              if (file !== null) {
                void read(file, step.chat.dateOrder === 'dmy' ? 'mdy' : 'dmy');
              }
            }}
          />
          {failure === null ? null : (
            <Alert tone="danger" data-pattern-state="error">
              {t(`upload.failed.${failure}`)}
            </Alert>
          )}
          <div>
            <Button
              disabled={!online || step.kind === 'uploading' || step.state.selected.size === 0}
              onClick={() => {
                void upload(step.chat, step.state);
              }}
            >
              {step.kind === 'uploading'
                ? t('upload.uploading')
                : t('upload.submit', { count: step.state.selected.size })}
            </Button>
          </div>
        </>
      ) : null}

      {step.kind === 'done' ? (
        <Alert tone="success" data-pattern-state="done">
          <p className="text-sm">{t('upload.done')}</p>
          <Link
            href={`/w/${encodeURIComponent(slug)}/inbox`}
            className="text-accent text-sm underline-offset-2 hover:underline"
          >
            {t('upload.openInbox')}
          </Link>
        </Alert>
      ) : null}
    </div>
  );
}
