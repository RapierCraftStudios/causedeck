// The mock speech-to-text for tests and fixtures: a `<file>.transcript.json` sidecar next to a
// synthetic recording holds what it "says", so the capture runs without a provider.
import { readFileSync } from 'node:fs';

import {
  buildTranscript,
  type RawSegment,
  type TranscribeInput,
  type TranscribePort,
  type Transcript,
  type TranscriptLanguage,
} from './transcribe.ts';

export interface TranscriptSidecar {
  language: TranscriptLanguage;
  segments: RawSegment[];
}

/** The sidecar of `file` (`<file>.transcript.json`). */
export function readTranscriptSidecar(file: string): TranscriptSidecar {
  return JSON.parse(readFileSync(`${file}.transcript.json`, 'utf8')) as TranscriptSidecar;
}

/** The transcript a sidecar stands for: segment texts joined by a space, ranges located in it. */
export function sidecarTranscript(sidecar: TranscriptSidecar): Transcript {
  const text = sidecar.segments.map((s) => s.text).join(' ');
  const durationMs = sidecar.segments.at(-1)?.endMs ?? 0;
  return buildTranscript(text, sidecar.language, sidecar.segments, durationMs);
}

export interface SidecarTranscribe extends TranscribePort {
  /** The inputs seen so far, in call order. */
  readonly calls: TranscribeInput[];
}

/** A port that answers every call with the sidecar's transcript. */
export function createSidecarTranscribe(sidecar: TranscriptSidecar): SidecarTranscribe {
  const calls: TranscribeInput[] = [];
  return {
    calls,
    transcribe(input) {
      calls.push(input);
      return Promise.resolve(sidecarTranscript(sidecar));
    },
  };
}
