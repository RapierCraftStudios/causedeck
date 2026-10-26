// Page images: a 150 DPI WebP thumbnail and a 1024 px WebP preview, made from the rendered PNG.
export const THUMBNAIL_DPI = 150;
export const PREVIEW_PX = 1024;
const WEBP_QUALITY = 80;

export interface PageImages {
  thumbnail: Uint8Array;
  preview: Uint8Array;
  /** Pixel size of the thumbnail. */
  width: number;
  height: number;
}

/** `png` is a page rendered at `THUMBNAIL_DPI`. */
export async function makePageImages(png: Uint8Array): Promise<PageImages> {
  // Loaded on first use: sharp is a native module and importing the package must not pull it in.
  const { default: sharp } = await import('sharp');
  const source = sharp(png);
  const thumb = await source
    .clone()
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });
  const preview = await source
    .clone()
    .resize({ width: PREVIEW_PX, height: PREVIEW_PX, fit: 'inside', withoutEnlargement: false })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
  return {
    thumbnail: new Uint8Array(thumb.data),
    preview: new Uint8Array(preview),
    width: thumb.info.width,
    height: thumb.info.height,
  };
}
