// The in-house template OCR engine (#1078): synthetic PNG captchas drawn from a 5x7 pixel font,
// no network and no real captcha. It trains on one rendering and reads another.
import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  createLocalSolver,
  createSolverChain,
  createMockPaidSolver,
  createTemplateOcrEngine,
  decodePng,
  measureAccuracy,
  trainGlyphTemplates,
} from '../index.ts';

const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
};

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** An 8-bit gray PNG (filter 0), or RGB when `rgb`. */
function encodePng(gray: Uint8Array, width: number, height: number, rgb = false): Uint8Array {
  const channels = rgb ? 3 : 1;
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < channels; c += 1) {
        raw[y * (width * channels + 1) + 1 + x * channels + c] = gray[y * width + x] ?? 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = rgb ? 2 : 0;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

function render(text: string, scale: number, options: { gap?: number; rgb?: boolean } = {}) {
  const gap = options.gap ?? 2 * scale;
  const pad = 4;
  const width = pad * 2 + text.length * 5 * scale + (text.length - 1) * gap;
  const height = pad * 2 + 7 * scale;
  const gray = new Uint8Array(width * height).fill(240);
  Array.from(text).forEach((char, i) => {
    const rows = FONT[char] ?? [];
    rows.forEach((row, ry) => {
      Array.from(row).forEach((bit, rx) => {
        if (bit !== '1') return;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            gray[(pad + ry * scale + dy) * width + pad + i * (5 * scale + gap) + rx * scale + dx] =
              20;
          }
        }
      });
    });
  });
  return encodePng(gray, width, height, options.rgb);
}

const TRAIN = ['ABCEH', 'LT72A', 'BEHL2', 'C7TAB', 'HEL72', 'TCBA7'];
const trained = trainGlyphTemplates(TRAIN.map((label) => ({ image: render(label, 3), label })));

describe('template OCR engine', () => {
  it('decodes a PNG and rejects other bytes', () => {
    const image = decodePng(render('AB', 2));
    expect(image?.height).toBe(7 * 2 + 8);
    expect(decodePng(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(decodePng(new Uint8Array(Buffer.from('SYNTHETIC-CAPTCHA\nk7m2p')))).toBeNull();
  });

  it('trains on every well-formed sample', () => {
    expect(trained.used).toBe(TRAIN.length);
    expect(trained.skipped).toBe(0);
    expect(Object.keys(trained.templates.glyphs).sort()).toEqual([
      '2',
      '7',
      'A',
      'B',
      'C',
      'E',
      'H',
      'L',
      'T',
    ]);
  });

  it('reads a captcha it has not seen, at another scale and in RGB', async () => {
    const engine = createTemplateOcrEngine(trained.templates);
    for (const [text, scale, rgb] of [
      ['HELTA', 3, false],
      ['27BCE', 4, false],
      ['TAB72', 2, true],
    ] as const) {
      const read = await engine.recognize(render(text, scale, { rgb }));
      expect(read?.text).toBe(text);
      expect(read?.confidence).toBeGreaterThan(0.6);
    }
  });

  it('is unreadable, not wrong, for touching glyphs, a wrong count and non-PNG bytes', async () => {
    const engine = createTemplateOcrEngine(trained.templates);
    expect(await engine.recognize(render('HELTA', 3, { gap: 0 }))).toBeNull();
    expect(await engine.recognize(render('AB', 3))).toBeNull();
    expect(await engine.recognize(new Uint8Array([0, 1, 2]))).toBeNull();
    expect(
      await createTemplateOcrEngine({ ...trained.templates, glyphs: {} }).recognize(
        render('ABCE', 3),
      ),
    ).toBeNull();
  });

  it('skips a training sample whose glyphs touch', () => {
    const out = trainGlyphTemplates([{ image: render('ABCE', 3, { gap: 0 }), label: 'ABCE' }]);
    expect(out.used).toBe(0);
    expect(out.skipped).toBe(1);
  });

  it('scores through the accuracy harness and falls back to paid on unreadable', async () => {
    const engine = createTemplateOcrEngine(trained.templates);
    const local = createLocalSolver(engine);
    const samples = [
      { name: 'a.png', image: render('HELTA', 3), label: 'HELTA' },
      { name: 'b.png', image: render('27BCE', 2), label: '27BCE' },
      { name: 'c.png', image: render('ABCE', 3, { gap: 0 }), label: 'ABCE' },
    ];
    const report = await measureAccuracy(samples, local);
    expect(report).toMatchObject({ total: 3, correct: 2, unreadable: 1 });

    const paid = createMockPaidSolver({ answer: () => 'ABCE' });
    const chain = createSolverChain({
      local,
      paid,
      dailyCostCapDollars: 1,
      now: () => Date.parse('2026-11-01T00:00:00Z'),
    });
    const outcome = await chain.solve({
      image: samples[2]?.image ?? new Uint8Array(),
      host: 'h.invalid',
    });
    expect(outcome).toMatchObject({ solved: true, tier: 'paid', text: 'ABCE' });
  });
});
