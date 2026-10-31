// Synthetic fixtures for the pipeline p95 benchmark (#561): invented hearing notes and a
// deterministic recording per note. No customer content. The default recording is a 60 s PCM WAV
// (a tone), the length of the "1 min note" the budget is stated for; the mock speech-to-text does
// not decode audio, and a real run should point `--audio-dir` at real synthetic recordings.

export interface BenchFixture {
  id: string;
  /** What the note says; the mock structuring and the matter match read this. */
  hearingDate: string;
  languageHints: readonly ('en' | 'hi' | 'ta' | 'kn')[];
  text: string;
}

export const BENCH_FIXTURES: readonly BenchFixture[] = [
  {
    id: 'adjourned-en',
    hearingDate: '2026-03-02',
    languageHints: ['en'],
    text: 'W.P. 12345 of 2026, Sharma versus State. Adjourned at the request of the respondent. List again on 2026-04-06. File the counter affidavit before that.',
  },
  {
    id: 'part-heard-en',
    hearingDate: '2026-03-03',
    languageHints: ['en'],
    text: 'C.S. 88 of 2025, Rao Traders versus Meridian Logistics. Part heard, arguments by the plaintiff concluded. Next hearing on 2026-03-24, defendant to argue.',
  },
  {
    id: 'mixed-hi-en',
    hearingDate: '2026-03-04',
    languageHints: ['hi', 'en'],
    text: 'Aaj ka hearing hua, Crl.A. 301 of 2024. Court ne notice issue kiya aur agli tarikh 2026-05-11 di. Vakalatnama aur certified copy jama karni hai.',
  },
  {
    id: 'relative-date-en',
    hearingDate: '2026-03-05',
    languageHints: ['en'],
    text: 'O.S. 17 of 2023, Iyer and Co versus Kumar. Evidence of PW2 recorded. Posted to the first Monday of next month for cross examination.',
  },
  {
    id: 'no-date-en',
    hearingDate: '2026-03-06',
    languageHints: ['en'],
    text: 'Mentioned the matter, W.A. 902 of 2026. Bench not available, no order passed. Check the cause list tomorrow and call the clerk.',
  },
];

function ascii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

/** A mono 16-bit PCM WAV of `seconds` at `sampleRate` Hz: a quiet tone at `frequencyHz`. */
export function syntheticWav(
  seconds: number,
  frequencyHz: number,
  sampleRate = 16_000,
): Uint8Array {
  const samples = Math.round(seconds * sampleRate);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  ascii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  ascii(view, 8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(view, 36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i += 1) {
    view.setInt16(
      44 + i * 2,
      Math.round(3000 * Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate)),
      true,
    );
  }
  return bytes;
}
