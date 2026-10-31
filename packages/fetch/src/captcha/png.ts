// A small PNG reader for the in-house OCR engine (#1078): 8-bit, non-interlaced images of every
// colour type, decoded to one gray byte per pixel with `node:zlib`. No native dependency. Anything
// else (JPEG, GIF, interlaced or 16-bit PNG) is `null`: the caller treats it as unreadable.
import { inflateSync } from 'node:zlib';

export interface GrayImage {
  width: number;
  height: number;
  /** Row-major, 0 black .. 255 white. */
  gray: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const MAX_PIXELS = 4_000_000;

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export function decodePng(bytes: Uint8Array): GrayImage | null {
  try {
    if (bytes.length < 33 || SIGNATURE.some((v, i) => bytes[i] !== v)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let width = 0;
    let height = 0;
    let colorType = -1;
    const data: Uint8Array[] = [];
    let palette: Uint8Array | null = null;
    let pos = 8;
    while (pos + 8 <= bytes.length) {
      const length = view.getUint32(pos);
      const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
      const body = bytes.subarray(pos + 8, pos + 8 + length);
      if (type === 'IHDR') {
        width = view.getUint32(pos + 8);
        height = view.getUint32(pos + 12);
        const depth = body[8];
        colorType = body[9] ?? -1;
        if (depth !== 8 || body[12] !== 0) return null;
      } else if (type === 'PLTE') palette = body;
      else if (type === 'IDAT') data.push(body);
      else if (type === 'IEND') break;
      pos += 12 + length;
    }
    const channels = CHANNELS[colorType];
    if (channels === undefined || width === 0 || height === 0 || width * height > MAX_PIXELS) {
      return null;
    }
    if (colorType === 3 && palette === null) return null;
    const raw = inflateSync(Buffer.concat(data));
    const stride = width * channels;
    if (raw.length < (stride + 1) * height) return null;
    const rows = new Uint8Array(stride * height);
    for (let y = 0; y < height; y += 1) {
      const filter = raw[y * (stride + 1)];
      const src = y * (stride + 1) + 1;
      const dst = y * stride;
      for (let x = 0; x < stride; x += 1) {
        const left = x >= channels ? (rows[dst + x - channels] ?? 0) : 0;
        const up = y > 0 ? (rows[dst - stride + x] ?? 0) : 0;
        const upLeft = y > 0 && x >= channels ? (rows[dst - stride + x - channels] ?? 0) : 0;
        const value = raw[src + x] ?? 0;
        let out: number;
        switch (filter) {
          case 0:
            out = value;
            break;
          case 1:
            out = value + left;
            break;
          case 2:
            out = value + up;
            break;
          case 3:
            out = value + ((left + up) >> 1);
            break;
          case 4:
            out = value + paeth(left, up, upLeft);
            break;
          default:
            return null;
        }
        rows[dst + x] = out & 0xff;
      }
    }
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i += 1) {
      const p = i * channels;
      let value: number;
      if (colorType === 0 || colorType === 4) value = rows[p] ?? 255;
      else if (colorType === 3) {
        const index = (rows[p] ?? 0) * 3;
        value = Math.round(
          0.299 * (palette?.[index] ?? 255) +
            0.587 * (palette?.[index + 1] ?? 255) +
            0.114 * (palette?.[index + 2] ?? 255),
        );
      } else {
        value = Math.round(
          0.299 * (rows[p] ?? 255) + 0.587 * (rows[p + 1] ?? 255) + 0.114 * (rows[p + 2] ?? 255),
        );
      }
      // Alpha over white.
      if (colorType === 4 || colorType === 6) {
        const alpha = (rows[p + channels - 1] ?? 255) / 255;
        value = Math.round(value * alpha + 255 * (1 - alpha));
      }
      gray[i] = value;
    }
    return { width, height, gray };
  } catch {
    return null;
  }
}
