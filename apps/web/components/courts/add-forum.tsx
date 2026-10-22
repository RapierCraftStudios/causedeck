'use client';
// The courts index's `Add forum` entry point (#427): the dialog (#402) brings Radix Dialog and
// Checkbox, the toaster and the forum validators, which put the route over its 40 KB chunk budget
// (`scripts/check-bundle-budget.mjs`). This renders the same `Add forum` button statically and loads
// `add-forum-dialog.tsx` in its own chunk at idle, or as soon as the button is hovered, focused or
// clicked. A click before the chunk arrives opens the dialog once it has loaded, and focus moves
// from the static button to its replacement.
import { Button } from '@causedeck/ui/button';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type * as DialogModule from './add-forum-dialog.tsx';
import type { AddForumDialogProps } from './add-forum-dialog.tsx';

let loaded: typeof DialogModule | null = null;
let pending: Promise<typeof DialogModule> | null = null;
const listeners = new Set<() => void>();

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
};

/** Load the dialog chunk once; a failed load is forgotten, so the next attempt tries again. */
export function loadAddForumDialog(): Promise<typeof DialogModule> {
  pending ??= import('./add-forum-dialog.tsx').then(
    (mod) => {
      loaded = mod;
      for (const notify of listeners) notify();
      return mod;
    },
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 2000 });
    return () => {
      window.cancelIdleCallback(id);
    };
  }
  const id = window.setTimeout(run, 200);
  return () => {
    window.clearTimeout(id);
  };
}

const prefetch = () => {
  // A prefetch that fails is not an error: clicking loads the chunk again.
  loadAddForumDialog().catch(() => undefined);
};

export function AddForum(props: AddForumDialogProps) {
  const t = useTranslations('courts.addForum');
  const mod = useSyncExternalStore(
    subscribe,
    () => loaded,
    () => null,
  );
  const [openOnLoad, setOpenOnLoad] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const hadFocus = useRef(false);

  useEffect(() => whenIdle(prefetch), []);

  useEffect(() => {
    if (mod === null || !hadFocus.current || openOnLoad) return;
    hadFocus.current = false;
    wrapper.current?.querySelector<HTMLElement>('[data-slot="add-forum"]')?.focus();
  }, [mod, openOnLoad]);

  if (mod !== null) {
    return (
      <div ref={wrapper} className="contents">
        <mod.AddForumDialog {...props} defaultOpen={openOnLoad} />
      </div>
    );
  }
  return (
    <div ref={wrapper} className="contents">
      <Button
        type="button"
        variant="secondary"
        data-slot="add-forum"
        className="self-start"
        onPointerEnter={prefetch}
        onFocus={() => {
          hadFocus.current = true;
          prefetch();
        }}
        onBlur={() => {
          hadFocus.current = false;
        }}
        onClick={() => {
          setOpenOnLoad(true);
          prefetch();
        }}
      >
        <Plus aria-hidden="true" />
        {t('trigger')}
      </Button>
    </div>
  );
}
