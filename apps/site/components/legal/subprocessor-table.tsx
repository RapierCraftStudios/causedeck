import { legalChrome } from '../../lib/legal-chrome.ts';
import type { Subprocessor } from '../../content/legal/sub-processors.ts';

export function SubprocessorTable({ rows }: { rows: readonly Subprocessor[] }) {
  const columns = legalChrome().subprocessorColumns;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-start text-sm">
        <caption className="sr-only">{legalChrome().indexTitle}: sub-processors</caption>
        <thead>
          <tr className="border-line border-b">
            {Object.values(columns).map((label) => (
              <th key={label} scope="col" className="py-2 pe-4 text-start font-semibold">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-line border-b align-top" data-subprocessor={row.id}>
              <th scope="row" className="py-3 pe-4 text-start font-medium">
                {row.url === undefined ? (
                  row.name
                ) : (
                  <a
                    href={row.url}
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    {row.name}
                  </a>
                )}
              </th>
              <td className="py-3 pe-4">{row.purpose}</td>
              <td className="py-3 pe-4">{row.dataCategories.join(', ')}</td>
              <td className="py-3 pe-4">{row.region}</td>
              <td className="py-3 pe-4">
                <time dateTime={row.effectiveDate}>{row.effectiveDate}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
