'use client';

import { useRef, type ReactNode } from 'react';

/**
 * Table of contents as a sheet for tablet widths (768 to 1279 px): a button opens a native modal
 * dialog docked to the start edge. Phones use the collapsible block; desktop uses the sticky rail.
 */
export function TocSheet({
  label,
  closeLabel,
  children,
}: {
  label: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        className="border-line rounded-md border px-3 py-2 font-medium"
        onClick={() => ref.current?.showModal()}
      >
        {label}
      </button>
      <dialog
        ref={ref}
        aria-label={label}
        className="bg-surface text-ink fixed inset-y-0 start-0 m-0 h-full max-h-none w-72 max-w-[85vw] p-5 backdrop:bg-black/40"
        onClick={(event) => {
          if (event.target === ref.current) ref.current.close();
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold">{label}</p>
          <button
            type="button"
            className="border-line rounded-md border px-2 py-1 text-sm"
            onClick={() => ref.current?.close()}
          >
            {closeLabel}
          </button>
        </div>
        <div onClick={() => ref.current?.close()}>{children}</div>
      </dialog>
    </>
  );
}
