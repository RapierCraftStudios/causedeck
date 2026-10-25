// Fixtures for rules.yml (JSX): see rules.ts.
declare const html: string;

export function Unsafe() {
  // ruleid: causedeck.unsafe-html-injection
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Safe() {
  // ok: causedeck.unsafe-html-injection
  return <div>{html}</div>;
}
