// The capture allow-list (#43): type from extension, declared MIME and magic bytes together; size
// caps with config overrides; PDFs are data, never executed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  assertBytesMatch,
  assertWithinCap,
  CaptureTooLargeError,
  DEFAULT_SIZE_CAPS_BYTES,
  resolveAllowedType,
  sizeCapBytes,
  UnsupportedTypeError,
} from '../index.ts';

import { SAMPLES, UPLOADS } from './samples.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MB = 1024 * 1024;

const uploads = Object.entries(UPLOADS) as [
  keyof typeof UPLOADS,
  (typeof UPLOADS)[keyof typeof UPLOADS],
][];

describe('allow-list', () => {
  it.each(uploads)('%s: accepted from its name, declared type and bytes', async (name, upload) => {
    const type = resolveAllowedType(upload.filename, upload.mime);
    await expect(assertBytesMatch(type, SAMPLES[name])).resolves.toEqual(expect.any(String));
  });

  it('accepts DOCX by name and declared type', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(resolveAllowedType('brief.docx', docx).name).toBe('docx');
    expect(resolveAllowedType('Chat.zip', 'application/zip').name).toBe('zip');
  });

  it.each([
    ['setup.exe', 'application/x-msdownload'],
    ['page.html', 'text/html'],
    ['brief.pdf.exe', 'application/pdf'],
    ['sheet.xlsx', 'application/vnd.ms-excel'],
    ['README', 'text/plain'],
    // The client-sent Content-Type alone never decides: it must fit the extension too.
    ['photo.png', 'application/pdf'],
  ])('rejects %s declared as %s with UnsupportedTypeError', (filename, mime) => {
    expect(() => resolveAllowedType(filename, mime)).toThrow(UnsupportedTypeError);
  });

  it('rejects bytes that contradict the extension', async () => {
    const pdf = resolveAllowedType('order.pdf', 'application/pdf');
    for (const bytes of [SAMPLES.png, SAMPLES.html, SAMPLES.exe, SAMPLES.txt]) {
      await expect(assertBytesMatch(pdf, bytes)).rejects.toMatchObject({
        name: 'UnsupportedTypeError',
        reason: 'content_mismatch',
      });
    }
    const mislabelled = new Uint8Array(readFileSync(join(HERE, '../../fixtures/mislabelled.pdf')));
    await expect(assertBytesMatch(pdf, mislabelled)).rejects.toBeInstanceOf(UnsupportedTypeError);
  });

  it('carries a user-safe message', () => {
    try {
      resolveAllowedType('setup.exe', 'application/octet-stream');
    } catch (error) {
      expect((error as UnsupportedTypeError).reason).toBe('not_allowed');
      expect((error as Error).message).not.toContain('setup.exe');
    }
  });
});

describe('size caps', () => {
  it('defaults to the issue caps', () => {
    expect(DEFAULT_SIZE_CAPS_BYTES).toMatchObject({
      pdf: 50 * MB,
      png: 20 * MB,
      jpeg: 20 * MB,
      webp: 20 * MB,
      heic: 20 * MB,
      m4a: 25 * MB,
      ogg: 25 * MB,
      docx: 25 * MB,
      ics: 1 * MB,
      txt: 5 * MB,
      zip: 100 * MB,
    });
  });

  it('accepts the cap and rejects one byte over, per type', () => {
    const ics = resolveAllowedType('a.ics', 'text/calendar');
    expect(() => {
      assertWithinCap(ics, MB);
    }).not.toThrow();
    expect(() => {
      assertWithinCap(ics, MB + 1);
    }).toThrow(CaptureTooLargeError);
  });

  it('takes per-name overrides', () => {
    const pdf = resolveAllowedType('a.pdf', 'application/pdf');
    expect(sizeCapBytes(pdf, { pdf: 10 })).toBe(10);
    expect(() => {
      assertWithinCap(pdf, 11, { pdf: 10 });
    }).toThrow(CaptureTooLargeError);
  });
});

describe('PDFs are data', () => {
  it('accepts a polyglot PDF with embedded JavaScript and never evaluates it', async () => {
    const bytes = new Uint8Array(readFileSync(join(HERE, '../../fixtures/polyglot-js.pdf')));
    expect(Buffer.from(bytes).toString('latin1')).toContain('app.alert');
    const pdf = resolveAllowedType('order.pdf', 'application/pdf');
    await expect(assertBytesMatch(pdf, bytes)).resolves.toBe('application/pdf');
    // The payload would have defined or called `app` had anything evaluated it.
    expect((globalThis as { app?: unknown }).app).toBeUndefined();
  });

  it('no capture code imports a PDF renderer or parser', () => {
    const roots = [
      join(HERE, '..'),
      join(HERE, '../../../core/src/capture'),
      join(HERE, '../../../../apps/web/app/api/captures'),
    ];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && !full.includes('__tests__')) files.push(full);
      }
    };
    for (const root of roots) walk(root);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(
        /from ['"](?:pdfjs-dist|pdf-lib|pdf-parse|pdf2json|mupdf|pdfkit|canvas|puppeteer|playwright)/,
      );
    }
  });
});
