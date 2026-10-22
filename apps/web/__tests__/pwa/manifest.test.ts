import { describe, expect, it } from 'vitest';

import manifest from '../../app/manifest.ts';

const m = manifest();

describe('web app manifest (#50)', () => {
  it('is installable: names, start URL, standalone, icons and colours', () => {
    expect(m).toMatchObject({
      name: 'CauseDeck',
      short_name: 'CauseDeck',
      start_url: '/',
      display: 'standalone',
    });
    expect(m.theme_color).toBeTruthy();
    expect(m.background_color).toBeTruthy();
    const icons = m.icons ?? [];
    const has = (size: string, purpose: string) =>
      icons.some((icon) => icon.sizes === size && icon.purpose === purpose);
    expect(has('192x192', 'any')).toBe(true);
    expect(has('512x512', 'any')).toBe(true);
    expect(has('192x192', 'maskable')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
  });

  it('declares the Web Share Target exactly as specified', () => {
    expect(m.share_target).toMatchObject({
      action: '/share-target',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: { title: 'title', text: 'text', url: 'url' },
    });
    const [files] = m.share_target?.params.files ?? [];
    expect(files?.name).toBe('files');
    const accept = Array.isArray(files?.accept) ? files.accept : [files?.accept];
    expect(accept).toEqual(
      expect.arrayContaining([
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'audio/*',
        'text/calendar',
        'text/plain',
        'application/zip',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ]),
    );
  });

  it('asks for no permission and registers no handler beyond sharing', () => {
    const keys = Object.keys(m);
    for (const key of ['permissions', 'protocol_handlers', 'file_handlers', 'related_applications']) {
      expect(keys).not.toContain(key);
    }
  });
});
