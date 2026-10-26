import { describe, expect, it } from 'vitest';

import {
  baseMime,
  dateHint,
  extensionFor,
  formatElapsed,
  pickMime,
} from '../lib/capture/voice/recorder.ts';
import { startMicrophone } from '../lib/capture/voice/permissions.ts';
import {
  matterFromSearch,
  voiceHref,
  wantsVoice,
} from '../lib/capture/voice/command-registration.ts';

const supports = (...types: string[]) => ({
  isTypeSupported: (type: string) => types.includes(type),
});

describe('voice format negotiation (#543)', () => {
  it('prefers webm/opus where supported', () => {
    expect(pickMime(supports('audio/webm;codecs=opus', 'audio/mp4'))).toBe(
      'audio/webm;codecs=opus',
    );
  });

  it('falls back to audio/mp4 on Safari', () => {
    expect(pickMime(supports('audio/mp4'))).toBe('audio/mp4');
  });

  it('lets the browser choose when nothing preferred is supported', () => {
    expect(pickMime(supports())).toBeUndefined();
  });

  it('declares the bare type and a matching extension', () => {
    expect(baseMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionFor('audio/mp4')).toBe('m4a');
  });
});

describe('elapsed time and the date hint', () => {
  it('formats the elapsed time the way it is announced', () => {
    expect(formatElapsed(12_400)).toBe('00:12');
    expect(formatElapsed(65_000)).toBe('01:05');
    expect(formatElapsed(-5)).toBe('00:00');
  });

  it('reads a date out of free text as a hint only', () => {
    expect(dateHint('next date is 14/11 at 10:30')).toBe('14/11');
    expect(dateHint('listed on 3-9-2026')).toBe('3/09');
    expect(dateHint('no date here')).toBeNull();
    expect(dateHint('room 45/99')).toBeNull();
  });
});

describe('microphone permission outcomes', () => {
  const failing = (name: string) => ({
    mediaDevices: { getUserMedia: () => Promise.reject(new DOMException('x', name)) },
  });

  it('reports denied, unavailable and error without throwing', async () => {
    expect(await startMicrophone(failing('NotAllowedError'))).toEqual({ kind: 'denied' });
    expect(await startMicrophone(failing('NotFoundError'))).toEqual({ kind: 'unavailable' });
    expect(await startMicrophone({})).toEqual({ kind: 'unavailable' });
    expect(await startMicrophone(failing('AbortError'))).toEqual({ kind: 'error' });
  });
});

describe('voice deep link', () => {
  it('adds ?capture=voice and keeps the rest of the address', () => {
    expect(voiceHref('/w/demo/today')).toBe('/w/demo/today?capture=voice');
    expect(voiceHref('/w/demo/today?x=1#top')).toBe('/w/demo/today?x=1&capture=voice#top');
    expect(wantsVoice('?capture=voice')).toBe(true);
    expect(wantsVoice('?capture=camera')).toBe(false);
  });

  it('prefills the matter only from a valid id', () => {
    const id = '5b2f0d4e-1c3a-4b5d-8e6f-7a8b9c0d1e2f';
    expect(matterFromSearch(`?capture=voice&matter=${id}`)).toBe(id);
    expect(matterFromSearch('?matter=not-an-id')).toBeUndefined();
  });
});
