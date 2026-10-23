// Speech to text (#541): gateway task `transcribe`. The audio goes to the India-region provider
// through the gateway (budget, audit, residency); the pipeline passes language hints (the
// speaker's profile languages plus the forum's language profile) and gets back a transcript whose
// segments carry millisecond bounds, a language tag and the character range they cover in the
// transcript text, so a later span can be traced to a moment in the recording.
import type { AiGateway, RunContext } from '@causedeck/ai';

export const TRANSCRIPT_LANGUAGES = ['en', 'hi', 'ta', 'kn', 'te', 'ml', 'mr', 'bn', 'gu'] as const;
export type TranscriptLanguage = (typeof TRANSCRIPT_LANGUAGES)[number];

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  language: TranscriptLanguage;
  text: string;
  /** Where the segment's text sits in `Transcript.text` (`[charStart, charEnd)`). */
  charStart: number;
  charEnd: number;
}

export interface Transcript {
  text: string;
  language: TranscriptLanguage;
  segments: TranscriptSegment[];
}

export interface TranscribeInput {
  audio: Uint8Array;
  mimeType: string;
  durationSeconds: number;
  /** Languages the speaker may use, most likely first (see `languageHints`). */
  languageHints?: readonly TranscriptLanguage[] | undefined;
}

/** Turns a recording into a transcript. The gateway-backed port is the product; tests use the sidecar. */
export interface TranscribePort {
  transcribe(input: TranscribeInput): Promise<Transcript>;
}

const known = (value: string): value is TranscriptLanguage =>
  (TRANSCRIPT_LANGUAGES as readonly string[]).includes(value);

/** Profile languages first, then the forum's, each once; unknown codes are dropped. */
export function languageHints(
  profileLanguages: readonly string[],
  forumLanguages: readonly string[] = [],
): TranscriptLanguage[] {
  return [...new Set([...profileLanguages, ...forumLanguages])].filter(known);
}

export interface RawSegment {
  startMs: number;
  endMs: number;
  language: TranscriptLanguage;
  text: string;
}

/**
 * A transcript of `text` with the character range of each segment located in order. A provider
 * that returned no segments yields one segment over the whole recording; a segment whose text
 * cannot be found in order keeps a range from the cursor of the same length, clamped to the text.
 */
export function buildTranscript(
  text: string,
  language: TranscriptLanguage,
  raw: readonly RawSegment[] | undefined,
  durationMs: number,
): Transcript {
  if (raw === undefined || raw.length === 0) {
    return {
      text,
      language,
      segments: [
        { startMs: 0, endMs: durationMs, language, text, charStart: 0, charEnd: text.length },
      ],
    };
  }
  let cursor = 0;
  const segments = raw.map((segment): TranscriptSegment => {
    const found = text.indexOf(segment.text, cursor);
    const charStart = found === -1 ? Math.min(cursor, text.length) : found;
    const charEnd = Math.min(text.length, charStart + segment.text.length);
    cursor = charEnd;
    return { ...segment, charStart, charEnd };
  });
  return { text, language, segments };
}

interface TranscribeOutput {
  text: string;
  language: TranscriptLanguage;
  segments?: RawSegment[] | undefined;
}

export interface GatewayTranscribeOptions {
  gateway: AiGateway;
  /** Workspace, capture, matter and user the call is charged and audited to. */
  scope: Pick<RunContext, 'workspaceId' | 'captureId' | 'matterId' | 'userId'>;
  pipelineVersion: string;
}

export function createGatewayTranscribe(options: GatewayTranscribeOptions): TranscribePort {
  const { gateway, scope, pipelineVersion } = options;
  return {
    async transcribe({ audio, mimeType, durationSeconds, languageHints: hints }) {
      const result = await gateway.run<TranscribeOutput>(
        'transcribe',
        {
          audioBase64: Buffer.from(audio).toString('base64'),
          mimeType,
          durationSeconds,
          ...(hints === undefined || hints.length === 0
            ? {}
            : { language: hints[0], languageHints: [...hints] }),
        },
        {
          ...scope,
          purpose: 'capture.transcribe',
          idempotencyKey: `capture-transcribe:${scope.captureId ?? 'none'}:${pipelineVersion}`,
        },
      );
      const { text, language, segments } = result.output;
      return buildTranscript(text, language, segments, Math.round(durationSeconds * 1000));
    },
  };
}
