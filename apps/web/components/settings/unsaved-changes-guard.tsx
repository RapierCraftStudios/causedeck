'use client';
// Dirty-state guard for settings forms (#284, #25 design spec). While a form has unsaved changes:
// - closing or reloading the tab asks through `beforeunload`;
// - clicking a same-origin link (sidebar, sub-nav, breadcrumbs) is held and a dialog asks
//   `Leave without saving?` (Leave / Stay; Esc stays, focus returns to the page);
// - the browser Back button is held the same way: a duplicate history entry absorbs the first
//   `popstate`, and Leave then goes back for real.
// Navigation the form starts itself (after a save) is not guarded because it is no longer dirty.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@causedeck/ui/alert-dialog';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

type Pending = { kind: 'link'; href: string } | { kind: 'back' };

/** The same-origin href a click would follow, or null when the click is not a plain navigation. */
export function guardedHref(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(target instanceof HTMLAnchorElement)) return null;
  if (target.target !== '' && target.target !== '_self') return null;
  if (target.hasAttribute('download')) return null;
  const url = new URL(target.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  const here = new URL(window.location.href);
  // In-page anchors (skip links, `#section`) are not navigation.
  if (url.pathname === here.pathname && url.search === here.search) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export interface UnsavedChangesGuardProps {
  dirty: boolean;
}

export function UnsavedChangesGuard({ dirty }: UnsavedChangesGuardProps) {
  const t = useTranslations('settings.unsaved');
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const dirtyRef = useRef(dirty);
  const trapped = useRef(false);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      const href = guardedHref(event);
      if (href === null) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ kind: 'link', href });
    };
    const onPopState = () => {
      if (!dirtyRef.current || !trapped.current) return;
      // The duplicate entry was popped: stay on this page and ask.
      trapped.current = false;
      setPending({ kind: 'back' });
    };
    if (!trapped.current) {
      window.history.pushState(window.history.state, '', window.location.href);
      trapped.current = true;
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, [dirty]);

  const stay = () => {
    if (pending?.kind === 'back' && dirtyRef.current && !trapped.current) {
      window.history.pushState(window.history.state, '', window.location.href);
      trapped.current = true;
    }
    setPending(null);
  };

  const leave = () => {
    const target = pending;
    setPending(null);
    dirtyRef.current = false;
    if (target?.kind === 'link') router.push(target.href);
    else if (target?.kind === 'back') window.history.back();
  };

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) stay();
      }}
    >
      <AlertDialogContent data-slot="unsaved-changes-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={stay}>{t('stay')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={leave}>
            {t('leave')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
