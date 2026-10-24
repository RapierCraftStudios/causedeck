// Photo processing before anything is stored or uploaded (#52): EXIF orientation applied, optional
// perspective correction from four corners, optional contrast enhancement, downscale to a 2000 px
// long edge and JPEG quality 0.85 (a page lands near 0.5 MB, under the 1.2 MB budget). The
// on-device sharpness check (variance of the Laplacian) and a glare check run on a small copy, so
// "Move closer" or "Glare on the right" can be said before upload.
import { outputSize, validQuad, warpPerspective, type Pixels, type Quad } from './deskew.ts';

export const MAX_LONG_EDGE = 2000;
export const JPEG_QUALITY = 0.85;
/** Variance of the Laplacian (on a 512 px copy) under which a page is too blurred to read. */
export const BLUR_VARIANCE_FLOOR = 60;
/** Share of near-white pixels over which glare hides writing. */
export const GLARE_FRACTION_CEILING = 0.18;
const QUALITY_EDGE = 512;

/** Size that fits `max` on the long edge, never enlarging. */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_LONG_EDGE,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const scale = max / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Luma of RGBA pixels. */
export function toGray(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(rgba.length / 4);
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] =
      0.299 * (rgba[i * 4] ?? 0) + 0.587 * (rgba[i * 4 + 1] ?? 0) + 0.114 * (rgba[i * 4 + 2] ?? 0);
  }
  return gray;
}

/** Variance of the 4-neighbour Laplacian: high for a sharp page, low for blur. */
export function laplacianVariance(gray: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const value =
        (gray[i - 1] ?? 0) +
        (gray[i + 1] ?? 0) +
        (gray[i - width] ?? 0) +
        (gray[i + width] ?? 0) -
        4 * (gray[i] ?? 0);
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

/** Share of pixels that are blown out to near-white. */
export function glareFraction(gray: ArrayLike<number>): number {
  let bright = 0;
  for (let i = 0; i < gray.length; i += 1) if ((gray[i] ?? 0) >= 250) bright += 1;
  return gray.length === 0 ? 0 : bright / gray.length;
}

export interface QualityReport {
  sharpness: number;
  glare: number;
  blurry: boolean;
  glaring: boolean;
}

export function assessQuality(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): QualityReport {
  const gray = toGray(rgba);
  const sharpness = laplacianVariance(gray, width, height);
  const glare = glareFraction(gray);
  return {
    sharpness,
    glare,
    blurry: sharpness < BLUR_VARIANCE_FLOOR,
    glaring: glare > GLARE_FRACTION_CEILING,
  };
}

/** Stretch the contrast around the page's own range (1st to 99th percentile), in place. */
export function enhanceContrast(rgba: Uint8ClampedArray): void {
  const histogram = new Array<number>(256).fill(0);
  const gray = toGray(rgba);
  for (const value of gray) histogram[value] = (histogram[value] ?? 0) + 1;
  const total = gray.length;
  let low = 0;
  let high = 255;
  let seen = 0;
  for (let v = 0; v < 256; v += 1) {
    seen += histogram[v] ?? 0;
    if (seen >= total * 0.01) {
      low = v;
      break;
    }
  }
  seen = 0;
  for (let v = 255; v >= 0; v -= 1) {
    seen += histogram[v] ?? 0;
    if (seen >= total * 0.01) {
      high = v;
      break;
    }
  }
  if (high - low < 16) return;
  const scale = 255 / (high - low);
  for (let i = 0; i < rgba.length; i += 4) {
    for (let c = 0; c < 3; c += 1) rgba[i + c] = ((rgba[i + c] ?? 0) - low) * scale;
  }
}

export interface ProcessOptions {
  /** The four corners in source pixels; the whole frame when absent. */
  corners?: Quad | undefined;
  enhance?: boolean | undefined;
  maxEdge?: number | undefined;
}

export interface ProcessedPhoto {
  blob: Blob;
  width: number;
  height: number;
  quality: QualityReport;
}

async function decode(source: Blob): Promise<ImageBitmap> {
  // `from-image` applies the EXIF orientation, so the pixels are upright from here on.
  return createImageBitmap(source, { imageOrientation: 'from-image' });
}

function draw(bitmap: ImageBitmap, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('no_canvas');
  context.drawImage(bitmap, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function encode(pixels: Pixels): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext('2d');
  if (context === null) return Promise.reject(new Error('no_canvas'));
  context.putImageData(
    new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height),
    0,
    0,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) reject(new Error('encode_failed'));
        else resolve(blob);
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

/** Process one photo: upright, corrected, enhanced, downscaled and JPEG-encoded. */
export async function processImage(
  source: Blob,
  options: ProcessOptions = {},
): Promise<ProcessedPhoto> {
  const bitmap = await decode(source);
  try {
    const full = draw(bitmap, bitmap.width, bitmap.height);
    let page: Pixels = { data: full.data, width: full.width, height: full.height };
    const { corners } = options;
    if (corners !== undefined && validQuad(corners)) {
      // Warp straight to the final size, so the page is sampled once.
      const natural = outputSize(corners);
      page = warpPerspective(
        page,
        corners,
        fitWithin(natural.width, natural.height, options.maxEdge ?? MAX_LONG_EDGE),
      );
    } else {
      const target = fitWithin(page.width, page.height, options.maxEdge ?? MAX_LONG_EDGE);
      if (target.width !== page.width) {
        const small = draw(bitmap, target.width, target.height);
        page = { data: small.data, width: small.width, height: small.height };
      }
    }
    if (options.enhance === true) enhanceContrast(page.data);
    const blob = await encode(page);
    const check = fitWithin(page.width, page.height, QUALITY_EDGE);
    const probeBitmap = await createImageBitmap(blob);
    const probe = draw(probeBitmap, check.width, check.height);
    probeBitmap.close();
    return {
      blob,
      width: page.width,
      height: page.height,
      quality: assessQuality(probe.data, probe.width, probe.height),
    };
  } finally {
    bitmap.close();
  }
}

/** The hint to show, rate-limited by the caller, for a quality report; null when it is fine. */
export function hintFor(quality: QualityReport): 'blurry' | 'glare' | null {
  if (quality.blurry) return 'blurry';
  return quality.glaring ? 'glare' : null;
}
