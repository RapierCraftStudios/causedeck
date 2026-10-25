import { legalChrome } from '../../lib/legal-chrome.ts';

export function VersionHistory({ history }: { history: { date: string; summary: string }[] }) {
  const chrome = legalChrome();
  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section aria-labelledby="version-history" className="mt-12">
      <h2 id="version-history" className="font-serif text-2xl">
        {chrome.versionHistory}
      </h2>
      <ul className="mt-4 space-y-2">
        {sorted.map((entry) => (
          <li key={`${entry.date}-${entry.summary}`}>
            <time dateTime={entry.date} className="font-medium">
              {entry.date}
            </time>
            : {entry.summary}
          </li>
        ))}
      </ul>
    </section>
  );
}
