import { loadChangelog } from '../../lib/changelog.ts';
import { pageMetadata } from '../../lib/seo.ts';

export const metadata = pageMetadata({
  title: 'Changelog',
  description:
    'Product changes to CauseDeck, newest first, with a version and a date for each release.',
  path: 'changelog',
});

const PROSE =
  '[&_h3]:text-ink [&_h3]:font-serif [&_h3]:text-lg [&_h3]:font-semibold [&_li]:mt-2 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:ps-6 [&_a]:underline';

export default async function ChangelogPage() {
  const entries = await loadChangelog();
  return (
    <div className="max-w-[68ch] md:max-w-none">
      <h1 className="text-ink font-serif text-4xl font-semibold md:text-5xl">Changelog</h1>
      <p className="text-ink-muted mt-4 max-w-[60ch] text-lg">
        Product changes only, newest first. Subscribe with the{' '}
        <a
          href="/changelog/feed.xml"
          className="text-accent underline underline-offset-2"
          type="application/rss+xml"
        >
          RSS feed
        </a>
        .
      </p>
      <ol className="mt-10 space-y-12">
        {entries.map((entry) => (
          <li
            key={entry.version}
            id={`v${entry.version}`}
            className="border-line scroll-mt-20 border-t pt-6 md:grid md:grid-cols-[11rem_minmax(0,1fr)] md:gap-8"
          >
            <p className="text-ink-muted text-sm tabular-nums">
              <time dateTime={entry.date}>{entry.date}</time>
              <span className="mt-1 block">Version {entry.version}</span>
            </p>
            <div className="text-ink mt-3 max-w-[60ch] md:mt-0">
              <h2 className="font-serif text-2xl font-semibold">{entry.title}</h2>
              <div className={PROSE}>{entry.content}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
