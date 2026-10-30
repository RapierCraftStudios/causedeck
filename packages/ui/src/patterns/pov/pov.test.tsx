// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ContextTestView,
  PreparednessTapView,
  PulseCardView,
  type ContextTestLabels,
  type PulseLabels,
  type TapLabels,
} from './pov';

afterEach(cleanup);

const option = (n: number) => `${String(n)} of 5`;
const tapLabels: TapLabels = {
  title: 'How prepared?',
  hint: 'Optional.',
  legend: 'Preparedness',
  option,
  skip: 'Skip',
  retry: 'Try again',
  messages: { saved: 'Saved.', error: 'Failed.', denied: 'Viewers are not asked.' },
};

function tap(props: Partial<React.ComponentProps<typeof PreparednessTapView>> = {}) {
  const handlers = { onRate: vi.fn(), onSkip: vi.fn(), onRetry: vi.fn() };
  render(
    <PreparednessTapView
      labels={tapLabels}
      state="default"
      value={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('PreparednessTapView', () => {
  it('rates on click and by digit key, and skips with S or the button', async () => {
    const { onRate, onSkip } = tap();
    await userEvent.click(screen.getByRole('radio', { name: '4 of 5' }));
    expect(onRate).toHaveBeenCalledWith(4);
    await userEvent.keyboard('2');
    expect(onRate).toHaveBeenLastCalledWith(2);
    await userEvent.keyboard('s');
    expect(onSkip).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSkip).toHaveBeenCalledTimes(2);
  });

  it('marks the chosen value and announces the state in a polite status', () => {
    tap({ state: 'saved', value: 3 });
    expect(screen.getByRole('radio', { name: '3 of 5' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: '1 of 5' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(screen.getByRole('status').textContent).toBe('Saved.');
  });

  it('moves focus with the arrow keys', async () => {
    tap();
    screen.getByRole('radio', { name: '1 of 5' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '2 of 5' }));
  });

  it('disables the scale while saving', () => {
    tap({ state: 'saving' });
    expect(screen.getByRole<HTMLButtonElement>('radio', { name: '2 of 5' }).disabled).toBe(true);
  });

  it('shows Try again only on error', async () => {
    const { onRetry } = tap({ state: 'error' });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
    cleanup();
    tap();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('asks a viewer nothing', () => {
    tap({ state: 'denied' });
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Viewers are not asked.');
  });
});

const pulseLabels: PulseLabels = {
  title: 'This week',
  intro: 'Three questions.',
  low: 'Low',
  high: 'High',
  option,
  submit: 'Save',
  dismiss: 'Not now',
  retry: 'Try again',
  messages: { saved: 'Thanks.', dismissed: 'Dismissed.', error: 'Failed.' },
};
const items = [
  { id: 'demand', label: 'Demand' },
  { id: 'worry', label: 'Worry' },
  { id: 'effort', label: 'Effort' },
];

function pulse(
  values: Record<string, number>,
  state: React.ComponentProps<typeof PulseCardView>['state'] = 'default',
) {
  const handlers = {
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onDismiss: vi.fn(),
    onRetry: vi.fn(),
  };
  render(
    <PulseCardView
      labels={pulseLabels}
      items={items}
      values={values}
      state={state}
      {...handlers}
    />,
  );
  return handlers;
}

describe('PulseCardView', () => {
  it('reports a value per item', async () => {
    const { onChange } = pulse({});
    const group = screen.getByRole('radiogroup', { name: 'Worry' });
    await userEvent.click(group.querySelector('[aria-label="5 of 5"]') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('worry', 5);
  });

  it('keeps Save disabled until all three are answered', async () => {
    const { onSubmit } = pulse({ demand: 2, worry: 3 });
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
    expect(save.disabled).toBe(true);
    cleanup();
    const second = pulse({ demand: 2, worry: 3, effort: 4 });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(second.onSubmit).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('dismisses with Not now and with Escape', async () => {
    const { onDismiss } = pulse({});
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    (screen.getAllByRole('radio', { name: '1 of 5' })[0] as HTMLElement).focus();
    await userEvent.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('shows only the message once saved or dismissed', () => {
    pulse({}, 'saved');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Thanks.');
  });

  it('offers Try again on error', async () => {
    const { onRetry } = pulse({ demand: 1, worry: 1, effort: 1 }, 'error');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

const testLabels: ContextTestLabels = {
  title: 'Context test',
  intro: 'Pick a matter.',
  start: 'Start',
  finish: 'Finish',
  again: 'Run another',
  retry: 'Try again',
  correct: 'Right',
  wrong: 'Wrong',
  elapsed: 'Elapsed',
  empty: 'None',
  messages: { running: 'Running', error: 'Failed.', offline: 'Offline.' },
};
const questions = ['a', 'b'].map((id) => ({ id, label: `Q ${id}`, mark: null as boolean | null }));

function contextTest(phase: React.ComponentProps<typeof ContextTestView>['phase'], qs = questions) {
  const handlers = {
    onStart: vi.fn(),
    onMark: vi.fn(),
    onFinish: vi.fn(),
    onAgain: vi.fn(),
    onRetry: vi.fn(),
  };
  render(
    <ContextTestView
      labels={testLabels}
      phase={phase}
      questions={qs}
      elapsed="0:42"
      matterPicker={<p>Matter picker</p>}
      {...handlers}
    />,
  );
  return handlers;
}

describe('ContextTestView', () => {
  it('starts from ready, and cannot start offline', async () => {
    const { onStart } = contextTest('ready');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onStart).toHaveBeenCalled();
    cleanup();
    contextTest('offline');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start' }).disabled).toBe(true);
  });

  it('marks questions while running and enables Finish only when all are marked', async () => {
    const { onMark } = contextTest('running');
    await userEvent.click(screen.getAllByRole('button', { name: 'Right' })[0] as HTMLElement);
    expect(onMark).toHaveBeenCalledWith('a', true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Finish' }).disabled).toBe(true);
    cleanup();
    const done = contextTest(
      'running',
      questions.map((q) => ({ ...q, mark: true })),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(done.onFinish).toHaveBeenCalled();
  });

  it('offers another run when finished, with no marking controls', async () => {
    const { onAgain } = contextTest(
      'finished',
      questions.map((q) => ({ ...q, mark: false })),
    );
    expect(screen.queryByRole('button', { name: 'Right' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Run another' }));
    expect(onAgain).toHaveBeenCalled();
  });

  it('shows Try again on error and nothing for a denied viewer', async () => {
    const { onRetry } = contextTest('error');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
    cleanup();
    contextTest('denied');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
