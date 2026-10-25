import { describe, expect, it } from 'vitest';

import { draftFileName, mailtoHref, whatsappHref } from '../../lib/outward/share-links.ts';

describe('share links', () => {
  it('builds a wa.me link with the text encoded and no recipient', () => {
    const href = whatsappHref('Next date: 12 Dec & more\nसाभार');
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(href.slice('https://wa.me/?text='.length))).toBe(
      'Next date: 12 Dec & more\nसाभार',
    );
    expect(href).not.toContain('\n');
  });

  it('builds a mailto link with subject and body and no recipient', () => {
    const href = mailtoHref('Update on A v B', 'Body & text');
    expect(href.startsWith('mailto:?subject=')).toBe(true);
    const params = new URLSearchParams(href.slice('mailto:?'.length));
    expect(params.get('subject')).toBe('Update on A v B');
    expect(params.get('body')).toBe('Body & text');
  });

  it('names the download after the matter, in any script', () => {
    expect(draftFileName('Ravi v. State of T.N.')).toBe('Ravi-v-State-of-T-N.txt');
    expect(draftFileName('வழக்கு 12')).toBe('வழக்கு-12.txt');
    expect(draftFileName('///')).toBe('update.txt');
  });
});
