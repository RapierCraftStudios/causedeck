// The voice capture domain (#542; PRD CA-3): `runVoiceProcess`, the body of the `voice.process`
// job. It transcribes a recording (gateway task `transcribe`), structures the transcript
// (`structure_hearing`), stores the transcript with its spans and stages the proposals. The pure
// steps are `@causedeck/intelligence` (`transcribe/`, `structure/`) and `@causedeck/capture`
// (`isUnreadableAudio`). Not re-exported from the package root.
export { runVoiceProcess, type VoiceProcessDeps, type VoiceProcessOutcome } from './run.ts';
export { anchorValues, citedSpans, type StoredTranscript } from './transcript.ts';
