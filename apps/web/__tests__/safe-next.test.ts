// Open-redirect guard for `?next=` (#153): only same-origin relative paths survive.
import { describe, expect, it } from 'vitest';

import { safeNextPath, signInPathFor } from '../lib/safe-next.ts';

describe('safeNextPath', () => {
  it.each([
    ['/w/anything', '/w/anything'],
    ['/w/demo/today', '/w/demo/today'],
    ['/w/a?x=1#h', '/w/a?x=1#h'],
    ['/account', '/account'],
    ['/', '/'],
  ])('keeps the same-origin relative path %j', (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    '//evil.com',
    '//evil.com/w/x',
    '/\\evil.com',
    '/\\/evil.com',
    '\\\\evil.com',
    'https://evil.com',
    'http://localhost:3000/w/x',
    'javascript:alert(1)',
    'data:text/html,hi',
    '\t//evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    ' /w/x',
    'w/anything',
    '../w/anything',
    '',
  ])('rejects %j and falls back', (raw) => {
    expect(safeNextPath(raw)).toBe('/');
    expect(safeNextPath(raw, '/fallback')).toBe('/fallback');
  });

  it.each([undefined, null, 42, ['/w/x'], { href: '/w/x' }])('rejects the non-string %j', (raw) => {
    expect(safeNextPath(raw)).toBe('/');
  });

  it('normalises dot segments without leaving the origin', () => {
    expect(safeNextPath('/w/../account')).toBe('/account');
    expect(safeNextPath('/../../etc')).toBe('/etc');
  });

  it('keeps encoded slashes encoded (never decodes into //host)', () => {
    expect(safeNextPath('/%2F%2Fevil.com')).toBe('/%2F%2Fevil.com');
    expect(safeNextPath('/%5Cevil.com')).toBe('/%5Cevil.com');
  });
});

describe('signInPathFor', () => {
  it('carries a protected path as an encoded next', () => {
    const target = signInPathFor('/w/anything');
    expect(target).toBe('/sign-in?next=%2Fw%2Fanything');
    expect(new URL(target, 'http://localhost').searchParams.get('next')).toBe('/w/anything');
  });

  it('keeps the query string of the original request', () => {
    const target = signInPathFor('/w/demo/matters?stage=filed');
    expect(new URL(target, 'http://localhost').searchParams.get('next')).toBe(
      '/w/demo/matters?stage=filed',
    );
  });

  it.each([null, undefined, '', '/', '//evil.com', 'https://evil.com'])(
    'drops next for %j',
    (raw) => {
      expect(signInPathFor(raw)).toBe('/sign-in');
    },
  );
});
