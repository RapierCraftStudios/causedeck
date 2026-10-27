import { useCallback, useEffect, useState, type RefObject } from 'react';

import { DEFAULT_FACT_LABELS, type FactLabels, type FactStatus } from './fact-squiggle';

const SELECTOR = '[data-slot="fact-squiggle"]:not([data-status="match"])';

/** Next index when stepping through `total` issues, wrapping; `current` -1 means none focused. */
export function nextIssueIndex(current: number, total: number, backwards: boolean): number {
  if (total === 0) return -1;
  if (current < 0) return backwards ? total - 1 : 0;
  return (current + (backwards ? total - 1 : 1)) % total;
}

/**
 * F8 / Shift+F8 move focus between the issues inside `containerRef`; Enter on a focused squiggle
 * opens its card (it is a button). Returns the text for a polite live region.
 */
export function useFactNavigation(
  containerRef: RefObject<HTMLElement | null>,
  labels?: Partial<Pick<FactLabels, 'announce' | 'status'>>,
): string {
  const [announcement, setAnnouncement] = useState('');
  const announce = labels?.announce ?? DEFAULT_FACT_LABELS.announce;
  const statusText = labels?.status ?? DEFAULT_FACT_LABELS.status;

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== 'F8' || event.altKey || event.ctrlKey || event.metaKey) return;
      const container = containerRef.current;
      if (!container) return;
      const issues = [...container.querySelectorAll<HTMLElement>(SELECTOR)];
      if (issues.length === 0) return;
      event.preventDefault();
      const current = issues.findIndex((el) => el === document.activeElement);
      const next = nextIssueIndex(current, issues.length, event.shiftKey);
      const target = issues[next];
      if (!target) return;
      target.focus();
      const status = target.dataset.status as FactStatus;
      setAnnouncement(
        announce({ index: next + 1, total: issues.length, status: statusText[status] }),
      );
    },
    [containerRef, announce, statusText],
  );

  useEffect(() => {
    const container = containerRef.current;
    container?.addEventListener('keydown', onKeyDown);
    return () => {
      container?.removeEventListener('keydown', onKeyDown);
    };
  }, [containerRef, onKeyDown]);

  return announcement;
}
