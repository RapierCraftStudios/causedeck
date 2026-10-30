import Link from 'next/link';

import type { SecurityCopy } from '../../content/security.ts';

/** Controls table: column and row headers are scoped; each row ends in a "How we prove it" cell. */
export function ControlsTable({ copy }: { copy: SecurityCopy }) {
  return (
    <div
      className="border-line my-6 overflow-x-auto rounded-2xl border"
      role="region"
      aria-label={copy.controlsCaption}
      tabIndex={0}
    >
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <caption className="sr-only">{copy.controlsCaption}</caption>
        <thead>
          <tr className="bg-surface-sunken">
            <th scope="col" className="text-ink px-4 py-3 text-start font-semibold">
              {copy.controlHeading}
            </th>
            <th scope="col" className="text-ink px-4 py-3 text-start font-semibold">
              {copy.detailHeading}
            </th>
            <th scope="col" className="text-ink px-4 py-3 text-start font-semibold">
              {copy.proofHeading}
            </th>
          </tr>
        </thead>
        <tbody>
          {copy.controls.map((control, index) => (
            <tr key={control.id} className={index % 2 === 0 ? 'bg-surface' : 'bg-surface-raised'}>
              <th scope="row" className="text-ink px-4 py-3 text-start align-top font-medium">
                {control.control}
              </th>
              <td className="text-ink-muted px-4 py-3 align-top">{control.detail}</td>
              <td className="text-ink-muted px-4 py-3 align-top">
                {control.proof.href === undefined ? (
                  control.proof.label
                ) : (
                  <Link
                    href={control.proof.href}
                    className="text-accent underline underline-offset-2"
                  >
                    {control.proof.label}
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
