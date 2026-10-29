'use client';
// The owner's context test (#86): pick a matter, start the clock, answer the five questions from the
// app, self-mark each, finish. The timer is announced at start and finish only.
import { ContextTestView, type ContextTestPhase } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  answerContextTestAction,
  finishContextTestAction,
  startContextTestAction,
} from './actions.ts';
import { questionList } from './questions.tsx';
import { useStopwatch } from './timer.tsx';

export function ContextTestFlow({
  workspaceId,
  matters,
  isOwner,
}: {
  workspaceId: string;
  matters: readonly { id: string; title: string }[];
  isOwner: boolean;
}) {
  const t = useTranslations('pov.test');
  const [phase, setPhase] = useState<ContextTestPhase>(isOwner ? 'ready' : 'denied');
  const [matterId, setMatterId] = useState(matters[0]?.id ?? '');
  const [run, setRun] = useState<{ id: string; at: number } | null>(null);
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<{ ms: number; correct: number } | null>(null);
  const [announce, setAnnounce] = useState('');
  const ms = useStopwatch(phase === 'running', run?.at ?? null);
  const seconds = result ? Math.round(result.ms / 1000) : Math.floor(ms / 1000);

  async function guard(step: () => Promise<void>) {
    if (!navigator.onLine) {
      setPhase('offline');
      return;
    }
    try {
      await step();
    } catch {
      setPhase('error');
    }
  }
  const start = () =>
    guard(async () => {
      const r = await startContextTestAction({ workspaceId, matterId });
      if (!r.ok) throw new Error(r.error.code);
      setRun({ id: r.data.runId, at: Date.now() });
      setMarks({});
      setResult(null);
      setPhase('running');
      setAnnounce(t('started'));
    });
  const mark = (question: string, correct: boolean) => {
    if (!run) return;
    setMarks((m) => ({ ...m, [question]: correct }));
    void guard(async () => {
      const r = await answerContextTestAction({
        workspaceId,
        runId: run.id,
        question,
        correct,
        atMs: Date.now() - run.at,
      });
      if (!r.ok) throw new Error(r.error.code);
    });
  };
  const finish = () =>
    run
      ? guard(async () => {
          const r = await finishContextTestAction({ workspaceId, runId: run.id });
          if (!r.ok) throw new Error(r.error.code);
          setResult({ ms: r.data.elapsedMs, correct: r.data.correct });
          setPhase('finished');
          setAnnounce(t('stopped'));
        })
      : undefined;

  return (
    <div data-slot="context-test-flow">
      <ContextTestView
        labels={{
          title: t('title'),
          intro: t('intro'),
          start: t('start'),
          finish: t('finish'),
          again: t('again'),
          retry: t('retry'),
          correct: t('correct'),
          wrong: t('wrong'),
          elapsed: t('elapsed', { seconds }),
          empty: t('empty'),
          messages: {
            running: t('running'),
            finished: result ? t('finished', { seconds, correct: result.correct }) : '',
            error: t('error'),
            offline: t('offline'),
            denied: t('denied'),
          },
        }}
        phase={matters.length === 0 && phase === 'ready' ? 'ready' : phase}
        questions={questionList((id) => t(`questions.${id as 'next_date'}`), marks)}
        elapsed={t('elapsed', { seconds })}
        matterPicker={
          <label className="grid gap-1 text-sm">
            {t('matter')}
            <select
              className="border-line min-h-12 rounded-md border px-2"
              value={matterId}
              onChange={(e) => {
                setMatterId(e.target.value);
              }}
            >
              {matters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
        }
        onStart={() => void start()}
        onMark={mark}
        onFinish={() => void finish()}
        onAgain={() => {
          setPhase('ready');
        }}
        onRetry={() => {
          setPhase(run && !result ? 'running' : 'ready');
        }}
      />
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
