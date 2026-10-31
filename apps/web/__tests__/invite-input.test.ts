// What the workspace switcher accepts for "Join with invite" (#1074).
import { describe, expect, it } from 'vitest';

import { invitePath, inviteTokenFrom } from '../lib/capture/paste/invite-input.ts';
import { PASTE_QUERY_KEY, wantsPaste } from '../lib/capture/paste/query.ts';

const TOKEN = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MC1fQUJDREVGRw';

describe('inviteTokenFrom', () => {
  it.each([
    [`https://app.causedeck.in/invite/${TOKEN}`, TOKEN],
    [`  http://localhost:3000/invite/${TOKEN}/  `, TOKEN],
    [`https://app.causedeck.in/invite/${TOKEN}?next=/x#top`, TOKEN],
    [`/invite/${TOKEN}`, TOKEN],
    [`https://app.causedeck.in/INVITE/${TOKEN}`, TOKEN],
    [TOKEN, TOKEN],
    [`  ${TOKEN}\n`, TOKEN],
  ])('reads %j', (raw, token) => {
    expect(inviteTokenFrom(raw)).toBe(token);
  });

  it.each([
    '',
    '   ',
    'hello there',
    'https://app.causedeck.in/today',
    'https://app.causedeck.in/invite/',
    'https://app.causedeck.in/invite/short',
    'short',
    `${TOKEN}!`,
    'https://app.causedeck.in/invite/%E0%A4%A',
  ])('refuses %j', (raw) => {
    expect(inviteTokenFrom(raw)).toBeNull();
  });

  it('builds the in-app path', () => {
    expect(invitePath(TOKEN)).toBe(`/invite/${TOKEN}`);
  });
});

describe('wantsPaste', () => {
  it('is true only for ?capture=paste', () => {
    expect(PASTE_QUERY_KEY).toBe('capture');
    expect(wantsPaste('capture=paste')).toBe(true);
    expect(wantsPaste(new URLSearchParams('matter=1&capture=paste'))).toBe(true);
    expect(wantsPaste('capture=voice')).toBe(false);
    expect(wantsPaste('')).toBe(false);
  });
});
