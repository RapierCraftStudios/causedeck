// Regenerates the synthetic diary pages (#52): `node fixtures/diary/generate.mjs`. Each page is an
// SVG rendering (`<lang>-NN.svg`), an OCR sidecar with line boxes (`<lang>-NN.ocr.json`, the mock
// OCR's answer) and the truth the eval scores against. Deterministic: no clock, no randomness.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ta: [
    'ஜனவரி',
    'பிப்ரவரி',
    'மார்ச்',
    'ஏப்ரல்',
    'மே',
    'ஜூன்',
    'ஜூலை',
    'ஆகஸ்ட்',
    'செப்டம்பர்',
    'அக்டோபர்',
    'நவம்பர்',
    'டிசம்பர்',
  ],
  kn: [
    'ಜನವರಿ',
    'ಫೆಬ್ರವರಿ',
    'ಮಾರ್ಚ್',
    'ಏಪ್ರಿಲ್',
    'ಮೇ',
    'ಜೂನ್',
    'ಜುಲೈ',
    'ಆಗಸ್ಟ್',
    'ಸೆಪ್ಟೆಂಬರ್',
    'ಅಕ್ಟೋಬರ್',
    'ನವೆಂಬರ್',
    'ಡಿಸೆಂಬರ್',
  ],
};
const WORDS = {
  en: {
    heard: 'arguments heard, next date',
    task: 'Call the clerk about the certified copy',
    remind: 'Reminder: file vakalat by',
  },
  ta: {
    heard: 'வாதம் முடிந்தது, அடுத்த தேதி',
    task: 'சான்றிட்ட நகல் குறித்து எழுத்தரை அழைக்க',
    remind: 'நினைவூட்டல்: வக்காலத்து தாக்கல்',
  },
  kn: {
    heard: 'ವಾದ ಮುಗಿದಿದೆ, ಮುಂದಿನ ದಿನಾಂಕ',
    task: 'ಪ್ರಮಾಣೀಕೃತ ಪ್ರತಿಯ ಬಗ್ಗೆ ಗುಮಾಸ್ತರಿಗೆ ಕರೆ ಮಾಡಿ',
    remind: 'ಜ್ಞಾಪನೆ: ವಕಾಲತ್ತು ಸಲ್ಲಿಸಿ',
  },
};
const TAMIL_DIGITS = '௦௧௨௩௪௫௬௭௮௯';
const toTamilDigits = (s) => s.replace(/\d/g, (d) => TAMIL_DIGITS[Number(d)]);
const pad = (n) => String(n).padStart(2, '0');
const COUNT = 30;

for (const lang of ['en', 'ta', 'kn']) {
  for (let i = 1; i <= COUNT; i += 1) {
    const day = 1 + ((i * 7) % 27);
    const month = 1 + ((i * 5) % 12);
    const dueDay = 1 + ((i * 11) % 27);
    const dueMonth = 1 + ((i * 3) % 12);
    const caseNo = 100 + i * 17;
    const tamilDigits = lang === 'ta' && i % 5 === 0;
    const num = (s) => (tamilDigits ? toTamilDigits(s) : s);
    const next = `${num(String(day))} ${MONTHS[lang][month - 1]} 2026`;
    const due = `${num(pad(dueDay))}/${num(pad(dueMonth))}/2026`;
    const header = `${num(pad((i % 28) + 1))}/${num('10')}/2026`;
    const w = WORDS[lang];
    const lines = [
      { text: header, conf: 0.92 },
      { text: `WP ${num(String(caseNo))}/2026 - ${w.heard} ${next}`, conf: 0.88 },
      { text: w.task, conf: 0.86 },
      { text: `${w.remind} ${due}`, conf: 0.84 },
    ].map((line, row) => ({ ...line, bbox: [0.06, 0.08 + row * 0.1, 0.94, 0.15 + row * 0.1] }));
    const truth = {
      entries: [
        {
          line: 2,
          kind: 'hearing_note',
          caseRef: `WP ${caseNo}/2026`,
          nextDate: `2026-${pad(month)}-${pad(day)}`,
          phrase: next,
        },
        { line: 3, kind: 'task', nextDate: null },
        {
          line: 4,
          kind: 'reminder',
          nextDate: `2026-${pad(dueMonth)}-${pad(dueDay)}`,
          phrase: due,
        },
      ],
    };
    const base = join(dir, `${lang}-${pad(i)}`);
    const text = lines.map((l) => l.text).join('\n');
    writeFileSync(
      `${base}.ocr.json`,
      `${JSON.stringify({ pages: [{ page: 1, text, confidence: 0.87, lines }], truth }, null, 1)}\n`,
    );
    const svg = lines
      .map(
        (l) =>
          `<text x="${l.bbox[0] * 800}" y="${l.bbox[3] * 1100}" font-size="28" font-family="Noto Sans, Noto Sans Tamil, Noto Sans Kannada">${l.text}</text>`,
      )
      .join('');
    writeFileSync(
      `${base}.svg`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100"><rect width="800" height="1100" fill="#fbf8ef"/>${svg}</svg>\n`,
    );
  }
}
