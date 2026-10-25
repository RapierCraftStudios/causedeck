// Research tab guards (#80): no iframe anywhere in the research components, and no AI import in the
// research route or components (no summary, answer or suggested authority; PX-6, PX-8).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const COMPONENTS = fileURLToPath(new URL('../../components/research/', import.meta.url));
const MATTER_ROUTE = fileURLToPath(
  new URL('../../app/(app)/w/[slug]/matters/[id]/research/', import.meta.url),
);
const SETTINGS_ROUTE = fileURLToPath(
  new URL('../../app/(app)/w/[slug]/settings/research/', import.meta.url),
);

function sources(dir: string): { file: string; text: string }[] {
  return readdirSync(dir)
    .filter((name) => /\.tsx?$/.test(name) && !name.includes('.stories.'))
    .map((name) => ({ file: `${dir}${name}`, text: readFileSync(`${dir}${name}`, 'utf8') }));
}

describe('research surfaces', () => {
  const all = [COMPONENTS, MATTER_ROUTE, SETTINGS_ROUTE].flatMap(sources);

  it('finds the files it guards', () => {
    expect(all.length).toBeGreaterThan(8);
  });

  it('never renders an iframe', () => {
    for (const { file, text } of all) expect(text, file).not.toMatch(/<iframe|<embed|<object/i);
  });

  it('never imports the AI package or calls a model', () => {
    for (const { file, text } of all) {
      expect(text, file).not.toMatch(/@causedeck\/ai|from 'ai'|openai|anthropic/i);
    }
  });

  it('opens every outside link in a new window without an opener', () => {
    const menu = readFileSync(`${COMPONENTS}link-out-menu.tsx`, 'utf8');
    expect(menu).toContain('target="_blank"');
    expect(menu).toContain('rel="noopener noreferrer"');
  });
});
