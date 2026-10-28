import { describe, expect, it } from 'vitest';

import { providerTemplateInput, researchAuthority, researchNoteInput } from './research';

describe('research validators', () => {
  it('accepts an https provider template with {q}', () => {
    const r = providerTemplateInput.safeParse({
      key: 'scc-online',
      label: 'SCC Online',
      urlTemplate: 'https://www.scconline.com/search?q={q}',
    });
    expect(r.success).toBe(true);
  });

  it.each([
    'javascript:alert(1)//{q}',
    'data:text/html,{q}',
    'http://x.test/?q={q}',
    'ftp://x.test/{q}',
  ])('rejects the unsafe template %s', (urlTemplate) => {
    expect(providerTemplateInput.safeParse({ key: 'x', label: 'X', urlTemplate }).success).toBe(
      false,
    );
  });

  it('requires the {q} placeholder', () => {
    const r = providerTemplateInput.safeParse({
      key: 'x',
      label: 'X',
      urlTemplate: 'https://x.test/',
    });
    expect(r.success).toBe(false);
  });

  it('keeps authority urls to https and defaults pinned to false', () => {
    expect(researchAuthority.safeParse({ label: 'A', url: 'javascript:alert(1)' }).success).toBe(
      false,
    );
    const ok = researchNoteInput.parse({
      title: 'T',
      authorities: [{ label: 'A', url: 'https://a.test/j' }],
    });
    expect(ok.authorities[0]?.pinned).toBe(false);
  });
});
