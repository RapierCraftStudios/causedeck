import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  createSidecarTranscribe,
  readTranscriptSidecar,
  sidecarTranscript,
  type TranscriptSidecar,
} from './mock.ts';
import { buildTranscript, createGatewayTranscribe, languageHints } from './transcribe.ts';

describe('languageHints', () => {
  it('lists profile languages then forum languages, once each, known codes only', () => {
    expect(languageHints(['ta', 'en'], ['kn', 'ta', 'xx'])).toEqual(['ta', 'en', 'kn']);
  });
});

describe('buildTranscript', () => {
  it('locates each segment in the text in order', () => {
    const t = buildTranscript(
      'one two. three',
      'en',
      [
        { startMs: 0, endMs: 900, language: 'en', text: 'one two.' },
        { startMs: 900, endMs: 1500, language: 'en', text: 'three' },
      ],
      1500,
    );
    expect(t.segments.map((s) => [s.charStart, s.charEnd])).toEqual([
      [0, 8],
      [9, 14],
    ]);
  });

  it('makes one segment over the recording when the provider gave none', () => {
    const t = buildTranscript('hello', 'en', undefined, 3000);
    expect(t.segments).toEqual([
      { startMs: 0, endMs: 3000, language: 'en', text: 'hello', charStart: 0, charEnd: 5 },
    ]);
  });
});

describe('createGatewayTranscribe', () => {
  it('runs the transcribe task with language hints and returns spanned segments', async () => {
    const run = vi.fn().mockResolvedValue({
      output: {
        text: 'அடுத்த hearing',
        language: 'ta',
        segments: [{ startMs: 0, endMs: 2000, language: 'ta', text: 'அடுத்த hearing' }],
      },
    });
    const port = createGatewayTranscribe({
      gateway: { run },
      scope: { workspaceId: 'w1', captureId: 'c1' },
      pipelineVersion: 'v1',
    });
    const transcript = await port.transcribe({
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/webm',
      durationSeconds: 2,
      languageHints: ['ta', 'en'],
    });
    expect(run).toHaveBeenCalledWith(
      'transcribe',
      expect.objectContaining({
        mimeType: 'audio/webm',
        language: 'ta',
        languageHints: ['ta', 'en'],
      }),
      expect.objectContaining({
        purpose: 'capture.transcribe',
        idempotencyKey: 'capture-transcribe:c1:v1',
      }),
    );
    expect(transcript.segments[0]).toMatchObject({ language: 'ta', charStart: 0, endMs: 2000 });
  });
});

describe('sidecar transcripts (mock provider)', () => {
  const sidecar: TranscriptSidecar = {
    language: 'en',
    segments: [
      { startMs: 0, endMs: 1000, language: 'en', text: 'Next hearing' },
      { startMs: 1000, endMs: 2500, language: 'en', text: 'on the 14th.' },
    ],
  };

  it('joins the segments and keeps their bounds and language tags', () => {
    const t = sidecarTranscript(sidecar);
    expect(t.text).toBe('Next hearing on the 14th.');
    expect(t.segments[1]).toMatchObject({ startMs: 1000, endMs: 2500, charStart: 13, charEnd: 25 });
  });

  it('reads <file>.transcript.json and answers every call from it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-'));
    const audio = join(dir, 'note.webm');
    writeFileSync(`${audio}.transcript.json`, JSON.stringify(sidecar));
    const port = createSidecarTranscribe(readTranscriptSidecar(audio));
    const t = await port.transcribe({
      audio: new Uint8Array(),
      mimeType: 'audio/webm',
      durationSeconds: 2.5,
    });
    expect(t.text).toBe('Next hearing on the 14th.');
    expect(port.calls).toHaveLength(1);
  });
});
