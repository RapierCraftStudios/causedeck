// Uploads (#217): allow-list and size caps at intent, magic-byte sniffing and sha256 at finalize,
// rejection of disallowed or mismatched content, `scan_status` bookkeeping, and no PDF rendering.
// The DB-backed tests run as causedeck_app in a rolled-back transaction, under FORCE RLS.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Transaction } from '@causedeck/db';
import { BLOB_SCAN_STATUSES, blob } from '@causedeck/db/schema';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_TYPES,
  createMemoryObjectStore,
  createUploadIntent,
  findAllowedType,
  finalizeUpload,
  isCompatible,
  MAX_OBJECT_BYTES,
  sniffMime,
} from '../index.ts';

import { ctxFor, errorOf, SAMPLES, TestForbiddenError } from './upload-fixtures.ts';

const NOW = new Date('2026-10-19T10:00:00Z');
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const FILES: Record<keyof typeof SAMPLES, { kind: string; filename: string; mime: string }> = {
  pdf: { kind: 'document', filename: 'Order 12.10.2026.pdf', mime: 'application/pdf' },
  docx: {
    kind: 'document',
    filename: 'brief.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  ics: { kind: 'document', filename: 'hearing.ics', mime: 'text/calendar' },
  txt: { kind: 'document', filename: 'WhatsApp Chat.txt', mime: 'text/plain' },
  png: { kind: 'image', filename: 'scan.png', mime: 'image/png' },
  jpeg: { kind: 'image', filename: 'photo.JPG', mime: 'image/jpeg' },
  heic: { kind: 'image', filename: 'IMG_0001.HEIC', mime: 'image/heic' },
  m4a: { kind: 'audio', filename: 'memo.m4a', mime: 'audio/x-m4a' },
  mp3: { kind: 'audio', filename: 'call.mp3', mime: 'audio/mpeg' },
  wav: { kind: 'audio', filename: 'dictation.wav', mime: 'audio/wav' },
  ogg: { kind: 'audio', filename: 'PTT-2026.opus', mime: 'audio/ogg' },
  webm: { kind: 'audio', filename: 'recording.webm', mime: 'audio/webm' },
  zip: { kind: 'zip', filename: 'WhatsApp Chat.zip', mime: 'application/zip' },
  html: { kind: 'document', filename: 'page.html', mime: 'text/html' },
  exe: { kind: 'document', filename: 'setup.exe', mime: 'application/x-msdownload' },
};

const ALLOWED_SAMPLES = (Object.keys(FILES) as (keyof typeof SAMPLES)[]).filter(
  (name) => name !== 'html' && name !== 'exe',
);

describe('upload allow-list and sniffing', () => {
  it.each(ALLOWED_SAMPLES)(
    '%s: allowed at intent and its bytes sniff as compatible',
    async (name) => {
      const file = FILES[name];
      const entry = findAllowedType(file.kind, file.filename, file.mime);
      expect(entry, name).not.toBeNull();
      if (entry === null) return;
      expect(isCompatible(entry, await sniffMime(SAMPLES[name]))).toBe(true);
    },
  );

  it('covers every type the issue lists', () => {
    expect(ALLOWED_TYPES.map((t) => t.name).sort()).toEqual(
      [
        'docx',
        'heic',
        'ics',
        'jpeg',
        'm4a',
        'mp3',
        'ogg',
        'pdf',
        'png',
        'txt',
        'wav',
        'webm',
        'webp',
        'zip',
      ].sort(),
    );
  });

  it.each([
    ['setup.exe', 'application/x-msdownload', 'document'],
    ['brief.pdf.exe', 'application/pdf', 'document'],
    ['brief.exe.pdf', 'application/pdf', 'document'],
    ['run.sh', 'text/plain', 'document'],
    ['index.html', 'text/html', 'document'],
    ['notes.txt', 'text/html', 'document'],
    ['logo.svg', 'image/svg+xml', 'image'],
    ['app.js', 'text/javascript', 'document'],
    ['data.xml', 'application/xml', 'document'],
    ['tool.jar', 'application/java-archive', 'zip'],
    ['brief.pdf', 'application/pdf', 'image'],
    ['brief.pdf', 'image/png', 'document'],
    ['README', 'text/plain', 'document'],
    ['sheet.xlsx', 'application/vnd.ms-excel', 'document'],
  ])('rejects %s declared as %s (%s)', (filename, mime, kind) => {
    expect(findAllowedType(kind, filename, mime)).toBeNull();
  });

  it('sniffs markup and scripts as text/html, never as plain text', async () => {
    for (const text of [
      '<!doctype html><p>x',
      '  <script>x()</script>',
      '<svg/>',
      '#!/bin/sh\nrm -rf /',
    ]) {
      expect(await sniffMime(new Uint8Array(Buffer.from(text)))).toBe('text/html');
    }
    expect(await sniffMime(SAMPLES.html)).toBe('text/html');
  });

  it('rejects HTML content for a pdf, an executable for a zip, and a zip for a docx', async () => {
    const pdf = findAllowedType('document', 'a.pdf', 'application/pdf');
    const zip = findAllowedType('zip', 'a.zip', 'application/zip');
    const docx = findAllowedType('document', 'a.docx', FILES.docx.mime);
    if (pdf === null || zip === null || docx === null) throw new Error('allow-list entry missing');
    expect(isCompatible(pdf, await sniffMime(SAMPLES.html))).toBe(false);
    expect(isCompatible(zip, await sniffMime(SAMPLES.exe))).toBe(false);
    expect(isCompatible(zip, await sniffMime(SAMPLES.docx))).toBe(false);
    expect(isCompatible(docx, await sniffMime(SAMPLES.zip))).toBe(false);
    expect(isCompatible(pdf, await sniffMime(new Uint8Array([0xff, 0xfe, 0x00, 0x01])))).toBe(
      false,
    );
  });
});

describe('createUploadIntent and finalizeUpload', () => {
  const setup = async (tx: Transaction, allow?: ('document.read' | 'document.write')[]) => {
    const { a, ua } = await seedTwoTenants(tx);
    const store = createMemoryObjectStore({ now: () => NOW });
    const ctx = ctxFor({
      db: tx,
      store,
      workspaceId: a.id,
      userId: ua,
      now: () => NOW,
      ...(allow ? { allow } : {}),
    });
    return { a, ua, store, ctx };
  };

  const rowOf = (tx: Transaction, workspaceId: string, id: string) =>
    inWorkspace(tx, workspaceId, async (scoped) => {
      const [row] = await scoped.select().from(blob).where(eq(blob.id, id));
      return row ?? null;
    });

  it('returns a 5-minute PUT bound to a server-built key, type and length, and records an open intent', async () => {
    await withTestDb(async (tx) => {
      const { a, ua, ctx } = await setup(tx);
      const intent = await createUploadIntent(ctx, { ...FILES.pdf, size: SAMPLES.pdf.byteLength });
      expect(ctx.checked).toEqual(['document.write']);
      expect(intent.key).toBe(`ws/${a.id}/document/2026/${intent.blobId}`);
      expect(intent.upload.method).toBe('PUT');
      expect(intent.upload.headers).toEqual({
        'content-type': 'application/pdf',
        'content-length': String(SAMPLES.pdf.byteLength),
      });
      expect(intent.upload.expiresAt.getTime() - NOW.getTime()).toBe(300_000);
      const row = await rowOf(tx, a.id, intent.blobId);
      expect(row).toMatchObject({
        key: intent.key,
        filename: FILES.pdf.filename,
        size: SAMPLES.pdf.byteLength,
        mime: 'application/pdf',
        scanStatus: null,
        sha256: null,
        finalizedAt: null,
        createdBy: ua,
      });
    });
  });

  it('enforces size caps and file names, and rejects disallowed types at intent', async () => {
    await withTestDb(async (tx) => {
      const { a, ctx } = await setup(tx);
      expect(
        await errorOf(
          createUploadIntent(ctx, { ...FILES.pdf, size: MAX_OBJECT_BYTES.document + 1 }),
        ),
      ).toMatchObject({ code: 'TOO_LARGE' });
      expect(await errorOf(createUploadIntent(ctx, { ...FILES.pdf, size: 0 }))).toMatchObject({
        code: 'VALIDATION',
      });
      expect(await errorOf(createUploadIntent(ctx, { ...FILES.pdf, size: -1 }))).toMatchObject({
        code: 'VALIDATION',
      });
      expect(
        await errorOf(
          createUploadIntent(ctx, { ...FILES.pdf, filename: '../../etc/x.pdf', size: 10 }),
        ),
      ).toMatchObject({ code: 'VALIDATION' });
      expect(await errorOf(createUploadIntent(ctx, { ...FILES.exe, size: 10 }))).toMatchObject({
        code: 'VALIDATION',
      });
      expect(await errorOf(createUploadIntent(ctx, { ...FILES.html, size: 10 }))).toMatchObject({
        code: 'VALIDATION',
      });
      expect(
        await errorOf(createUploadIntent(ctx, { ...FILES.pdf, kind: 'executable', size: 10 })),
      ).toMatchObject({ code: 'VALIDATION' });
      // Audio is capped at 100 MiB, the zip kind at 200 MiB.
      await createUploadIntent(ctx, { ...FILES.zip, size: MAX_OBJECT_BYTES.zip });
      expect(
        await errorOf(createUploadIntent(ctx, { ...FILES.mp3, size: MAX_OBJECT_BYTES.audio + 1 })),
      ).toMatchObject({ code: 'TOO_LARGE' });
      const count = await inWorkspace(tx, a.id, (scoped) =>
        scoped
          .select({ n: sql<number>`count(*)::int` })
          .from(blob)
          .where(sql`${blob.finalizedAt} is null`),
      );
      expect(count[0]?.n).toBe(1);
    });
  });

  it('checks document.write before anything else', async () => {
    await withTestDb(async (tx) => {
      const { ctx } = await setup(tx, ['document.read']);
      expect(await errorOf(createUploadIntent(ctx, { ...FILES.pdf, size: 10 }))).toBeInstanceOf(
        TestForbiddenError,
      );
      expect(await errorOf(finalizeUpload(ctx, crypto.randomUUID()))).toBeInstanceOf(
        TestForbiddenError,
      );
    });
  });

  it.each(ALLOWED_SAMPLES)(
    '%s: finalize sniffs, hashes and marks the blob pending',
    async (name) => {
      await withTestDb(async (tx) => {
        const { a, store, ctx } = await setup(tx);
        const body = SAMPLES[name];
        const intent = await createUploadIntent(ctx, { ...FILES[name], size: body.byteLength });
        await store.upload(intent.upload.url, {
          body,
          contentType: intent.upload.headers['content-type'],
        });
        const done = await finalizeUpload(ctx, intent.blobId);
        expect(done).toMatchObject({
          blobId: intent.blobId,
          size: body.byteLength,
          sha256: createHash('sha256').update(body).digest('hex'),
          scanStatus: 'pending',
        });
        const row = await rowOf(tx, a.id, intent.blobId);
        expect(row?.scanStatus).toBe('pending');
        expect(row?.finalizedAt).toEqual(NOW);
        expect(row?.mime).toBe(done.mime);
        // Idempotent.
        expect(await finalizeUpload(ctx, intent.blobId)).toEqual(done);
      });
    },
  );

  it('rejects at finalize a .pdf holding HTML, deleting the object and the row', async () => {
    await withTestDb(async (tx) => {
      const { a, store, ctx } = await setup(tx);
      const body = SAMPLES.html;
      const intent = await createUploadIntent(ctx, { ...FILES.pdf, size: body.byteLength });
      await store.upload(intent.upload.url, { body, contentType: 'application/pdf' });
      expect(await errorOf(finalizeUpload(ctx, intent.blobId))).toMatchObject({
        code: 'VALIDATION',
      });
      expect(await store.head(intent.key)).toBeNull();
      expect(await rowOf(tx, a.id, intent.blobId)).toBeNull();
      expect(await errorOf(finalizeUpload(ctx, intent.blobId))).toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  it.each([
    ['an executable named .zip', 'zip', 'exe'],
    ['a zip named .docx', 'docx', 'zip'],
    ['a docx named .zip', 'zip', 'docx'],
    ['a png named .jpg', 'jpeg', 'png'],
    ['HTML named .txt', 'txt', 'html'],
  ] as const)('rejects %s at finalize', async (_label, declared, actual) => {
    await withTestDb(async (tx) => {
      const { a, store, ctx } = await setup(tx);
      const body = SAMPLES[actual];
      const intent = await createUploadIntent(ctx, { ...FILES[declared], size: body.byteLength });
      await store.upload(intent.upload.url, {
        body,
        contentType: intent.upload.headers['content-type'],
      });
      expect(await errorOf(finalizeUpload(ctx, intent.blobId))).toMatchObject({
        code: 'VALIDATION',
      });
      expect(await rowOf(tx, a.id, intent.blobId)).toBeNull();
    });
  });

  it('rejects a stored object whose size differs from the declared size', async () => {
    await withTestDb(async (tx) => {
      const { a, store, ctx } = await setup(tx);
      const intent = await createUploadIntent(ctx, {
        ...FILES.pdf,
        size: SAMPLES.pdf.byteLength + 5,
      });
      await store.put({ key: intent.key, body: SAMPLES.pdf, contentType: 'application/pdf' });
      expect(await errorOf(finalizeUpload(ctx, intent.blobId))).toMatchObject({
        code: 'VALIDATION',
      });
      expect(await rowOf(tx, a.id, intent.blobId)).toBeNull();
    });
  });

  it('keeps the intent when nothing was uploaded yet', async () => {
    await withTestDb(async (tx) => {
      const { a, ctx } = await setup(tx);
      const intent = await createUploadIntent(ctx, { ...FILES.pdf, size: SAMPLES.pdf.byteLength });
      expect(await errorOf(finalizeUpload(ctx, intent.blobId))).toMatchObject({
        code: 'VALIDATION',
      });
      expect(await rowOf(tx, a.id, intent.blobId)).not.toBeNull();
    });
  });

  it('returns NOT_FOUND for an unknown or malformed blob id', async () => {
    await withTestDb(async (tx) => {
      const { ctx } = await setup(tx);
      expect(await errorOf(finalizeUpload(ctx, crypto.randomUUID()))).toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(await errorOf(finalizeUpload(ctx, 'not-a-uuid'))).toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});

describe('scan_status and PDF handling', () => {
  it('scan_status allows exactly pending, clean, infected and skipped', async () => {
    expect([...BLOB_SCAN_STATUSES]).toEqual(['pending', 'clean', 'infected', 'skipped']);
    await withTestDb(async (tx) => {
      const { a } = await seedTwoTenants(tx);
      const id = a.rows.blob?.id ?? '';
      for (const status of BLOB_SCAN_STATUSES) {
        await inWorkspace(tx, a.id, (scoped) =>
          scoped.update(blob).set({ scanStatus: status }).where(eq(blob.id, id)),
        );
      }
      const failure = await inWorkspace(tx, a.id, (scoped) =>
        scoped
          .transaction((sp) =>
            sp.execute(sql`update blob set scan_status = 'quarantined' where id = ${id}`),
          )
          .then(
            () => null,
            (error: unknown) =>
              (error as { cause?: { code?: string } }).cause?.code ??
              (error as { code?: string }).code,
          ),
      );
      expect(failure).toBe('23514');
    });
  });

  it('no code path in @causedeck/storage renders or executes PDF content', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(
      deps.filter((d) => /pdf|puppeteer|playwright|canvas|sharp|ghostscript|mupdf/i.test(d)),
    ).toEqual([]);
    const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(
      (file) => file.endsWith('.ts') && !file.includes('__tests__') && !file.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const text = readFileSync(join(SRC, file), 'utf8');
      expect(text, file).not.toMatch(
        /from ['"](?:[^'"]*pdf[^'"]*|node:vm|node:child_process|vm|child_process)['"]/i,
      );
      expect(text, file).not.toMatch(/\beval\(|new Function\(/);
    }
  });
});
