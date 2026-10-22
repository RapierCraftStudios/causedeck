// The MuPDF (WASM) renderer. MuPDF renders PDFs and images to pixmaps without a JavaScript
// engine, so an `app.alert` in the file is never executed.
import { RenderPasswordError, type OpenedDocument, type PageRenderer } from './renderer.ts';

const POINTS_PER_INCH = 72;

export const mupdfRenderer: PageRenderer = {
  async open(bytes, mime): Promise<OpenedDocument> {
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(bytes.slice(), mime);
    if (doc.needsPassword()) {
      doc.destroy();
      throw new RenderPasswordError('document is password protected');
    }
    return {
      pageCount: doc.countPages(),
      renderPage(pageNo, dpi) {
        const page = doc.loadPage(pageNo - 1);
        try {
          const scale = dpi / POINTS_PER_INCH;
          const pixmap = page.toPixmap(
            mupdf.Matrix.scale(scale, scale),
            mupdf.ColorSpace.DeviceRGB,
            false,
            true,
          );
          try {
            return Promise.resolve({
              png: pixmap.asPNG(),
              width: pixmap.getWidth(),
              height: pixmap.getHeight(),
            });
          } finally {
            pixmap.destroy();
          }
        } finally {
          page.destroy();
        }
      },
      close() {
        doc.destroy();
      },
    };
  },
};
