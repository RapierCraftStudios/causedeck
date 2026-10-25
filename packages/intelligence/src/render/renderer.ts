// The page renderer port (spike §6: documents are rendered to images in a worker, never in the
// browser, and PDF JavaScript never runs). The WASM implementation is `mupdf.ts`; tests and the
// docx/text paths use `noRenderer`.
export interface RenderedPage {
  png: Uint8Array;
  width: number;
  height: number;
}

export interface OpenedDocument {
  pageCount: number;
  /** One page as PNG at `dpi`. */
  renderPage(pageNo: number, dpi: number): Promise<RenderedPage>;
  close(): void;
}

export class RenderPasswordError extends Error {
  override name = 'RenderPasswordError';
}

export interface PageRenderer {
  /** Open a PDF or image. `mime` is the sniffed type (`application/pdf`, `image/png`, ...). */
  open(bytes: Uint8Array, mime: string): Promise<OpenedDocument>;
}

/** A renderer for formats with no page images (plain text, DOCX): every open fails. */
export const noRenderer: PageRenderer = {
  open: () => Promise.reject(new Error('this format has no page images')),
};
