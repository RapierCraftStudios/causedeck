// The camera session's writes to the encrypted outbox (#52). Each page is stored (held back from
// upload) the moment it is taken, so a tab crash loses nothing; "Done" replaces the held pages with
// one multi-page PDF item on the `camera` channel, in page order, sharing the session's `batchId`.
// The processed JPEG is the only image uploaded unless the person keeps "Original".
import { decryptBytes } from '../../pwa/outbox/crypto.ts';
import type { OutboxItem, OutboxStore } from '../../pwa/outbox/db.ts';
import {
  enqueueFiles,
  notifyOutboxChanged,
  removeItem,
  type EnqueueOptions,
} from '../../pwa/outbox/queue.ts';

const PAGE_PREFIX = 'page-';
const ORIGINAL_PREFIX = 'original-';

const pad = (n: number): string => String(n).padStart(3, '0');
const pageName = (n: number): string => `${PAGE_PREFIX}${pad(n)}.jpg`;

export interface SessionOptions {
  batchId: string;
  workspaceId: string | null;
  matterHintId?: string | undefined;
  capBytes?: number | undefined;
}

function options(session: SessionOptions, extra: Partial<EnqueueOptions> = {}): EnqueueOptions {
  return {
    workspaceId: session.workspaceId,
    channel: 'camera',
    batchId: session.batchId,
    matterHintId: session.matterHintId,
    capBytes: session.capBytes,
    ...extra,
  };
}

/** Held camera items of one batch, pages in order (originals last). */
export function heldItems(items: readonly OutboxItem[], batchId: string): OutboxItem[] {
  return items
    .filter((item) => item.channel === 'camera' && item.batchId === batchId && item.hold === true)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const pagesOf = (items: readonly OutboxItem[]): OutboxItem[] =>
  items.filter((item) => item.name.startsWith(PAGE_PREFIX));

/** Store a processed page, encrypted, before any network call. Returns the stored item. */
export async function savePage(
  store: OutboxStore,
  key: CryptoKey,
  session: SessionOptions,
  page: { index: number; photo: Blob; original?: Blob | undefined },
): Promise<OutboxItem> {
  const files = [new File([page.photo], pageName(page.index), { type: 'image/jpeg' })];
  const result = await enqueueFiles(store, key, files, options(session, { hold: true }));
  if (page.original !== undefined) {
    await enqueueFiles(
      store,
      key,
      [
        new File([page.original], `${ORIGINAL_PREFIX}${pad(page.index)}.jpg`, {
          type: page.original.type || 'image/jpeg',
        }),
      ],
      options(session, { hold: true }),
    );
  }
  notifyOutboxChanged();
  return result.items[0] as OutboxItem;
}

/** Delete a page (and its kept original) of the session. */
export async function deletePage(
  store: OutboxStore,
  session: SessionOptions,
  index: number,
): Promise<void> {
  const held = heldItems(await store.all(), session.batchId);
  for (const item of held) {
    if (item.name === pageName(index) || item.name === `${ORIGINAL_PREFIX}${pad(index)}.jpg`) {
      await removeItem(store, item.id);
    }
  }
  notifyOutboxChanged();
}

/** Put the pages in `order` (their current indexes): the names carry the order. */
export async function reorderPages(
  store: OutboxStore,
  session: SessionOptions,
  order: readonly number[],
): Promise<void> {
  const held = heldItems(await store.all(), session.batchId);
  const byName = new Map(held.map((item) => [item.name, item]));
  for (const [position, index] of order.entries()) {
    for (const [from, to] of [
      [pageName(index), `${PAGE_PREFIX}t${pad(position + 1)}.jpg`],
      [`${ORIGINAL_PREFIX}${pad(index)}.jpg`, `${ORIGINAL_PREFIX}t${pad(position + 1)}.jpg`],
    ] as const) {
      const item = byName.get(from);
      if (item !== undefined) await store.put({ ...item, name: to });
    }
  }
  // Second pass drops the temporary marker so names never collide mid-way.
  for (const item of heldItems(await store.all(), session.batchId)) {
    await store.put({ ...item, name: item.name.replace(/-t(\d{3})\.jpg$/, '-$1.jpg') });
  }
  notifyOutboxChanged();
}

export interface RecoverableSession {
  batchId: string;
  workspaceId: string | null;
  matterHintId?: string | undefined;
  pages: OutboxItem[];
}

/**
 * Sessions lost to a tab crash: held pages whose batch was never finished. Leftovers of a batch
 * that was finished (its PDF is already queued or sent) are dropped.
 */
export async function recoverSessions(store: OutboxStore): Promise<RecoverableSession[]> {
  const items = await store.all();
  const finished = new Set(
    items.filter((i) => i.channel === 'camera' && i.hold !== true).map((i) => i.batchId),
  );
  const sessions = new Map<string, RecoverableSession>();
  for (const item of items) {
    if (item.channel !== 'camera' || item.hold !== true) continue;
    if (finished.has(item.batchId)) {
      await removeItem(store, item.id);
      continue;
    }
    const found = sessions.get(item.batchId) ?? {
      batchId: item.batchId,
      workspaceId: item.workspaceId,
      matterHintId: item.matterHintId,
      pages: [],
    };
    if (item.name.startsWith(PAGE_PREFIX)) found.pages.push(item);
    sessions.set(item.batchId, found);
  }
  return [...sessions.values()]
    .filter((session) => session.pages.length > 0)
    .map((session) => ({
      ...session,
      pages: session.pages.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

/** Width and height from a JPEG's start-of-frame marker. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1] ?? 0;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0),
        width: ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0),
      };
    }
    i += 2 + (((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0));
  }
  throw new Error('not_a_jpeg');
}

const encoder = new TextEncoder();

/** A minimal PDF with one JPEG per page (DCT passthrough: the processed bytes are not re-encoded). */
export function buildPdf(jpegs: readonly Uint8Array[], dpi = 150): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: (Uint8Array | string)[]) => {
    offsets[id] = length;
    push(`${String(id)} 0 obj\n`);
    for (const chunk of body) push(chunk);
    push('\nendobj\n');
  };
  const count = jpegs.length;
  push('%PDF-1.4\n');
  object(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  const kids = jpegs.map((_, i) => `${String(3 + i * 3)} 0 R`).join(' ');
  object(2, [`<< /Type /Pages /Kids [${kids}] /Count ${String(count)} >>`]);
  jpegs.forEach((jpeg, i) => {
    const { width, height } = jpegSize(jpeg);
    const w = ((width * 72) / dpi).toFixed(2);
    const h = ((height * 72) / dpi).toFixed(2);
    const page = 3 + i * 3;
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    object(page, [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${String(page + 2)} 0 R >> >> /Contents ${String(page + 1)} 0 R >>`,
    ]);
    object(page + 1, [`<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`]);
    object(page + 2, [
      `<< /Type /XObject /Subtype /Image /Width ${String(width)} /Height ${String(height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${String(jpeg.length)} >>\nstream\n`,
      jpeg,
      '\nendstream',
    ]);
  });
  const xref = length;
  const total = 3 + count * 3;
  push(`xref\n0 ${String(total)}\n0000000000 65535 f \n`);
  for (let id = 1; id < total; id += 1)
    push(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${String(total)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of parts) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export interface FinishOptions {
  /** Upload the untouched originals too; off unless the person keeps "Original". */
  keepOriginals?: boolean | undefined;
}

/**
 * Finish a session: one multi-page PDF item (queued, ready to upload) in page order, the held
 * pages removed after it is stored. Originals are removed unless kept (then they are released).
 */
export async function finishBatch(
  store: OutboxStore,
  key: CryptoKey,
  session: SessionOptions,
  finish: FinishOptions = {},
): Promise<OutboxItem> {
  const held = heldItems(await store.all(), session.batchId);
  const pages = pagesOf(held);
  if (pages.length === 0) throw new Error('no_pages');
  const jpegs: Uint8Array[] = [];
  for (const page of pages) {
    jpegs.push(new Uint8Array(await decryptBytes(key, page)));
  }
  const pdf = buildPdf(jpegs);
  const file = new File(
    [pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer],
    `diary-${session.batchId.slice(0, 8)}.pdf`,
    {
      type: 'application/pdf',
    },
  );
  const { items } = await enqueueFiles(store, key, [file], options(session));
  for (const item of held) {
    const isOriginal = item.name.startsWith(ORIGINAL_PREFIX);
    if (isOriginal && finish.keepOriginals === true) {
      await store.put({ ...item, hold: undefined });
    } else {
      await removeItem(store, item.id);
    }
  }
  notifyOutboxChanged();
  return items[0] as OutboxItem;
}

/** Throw the whole session away (Close without keeping anything). */
export async function discardSession(store: OutboxStore, batchId: string): Promise<void> {
  for (const item of heldItems(await store.all(), batchId)) await removeItem(store, item.id);
  notifyOutboxChanged();
}
