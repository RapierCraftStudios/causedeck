// The PDF text layer, per page (DI-1). pdfjs only parses and extracts: no scripting sandbox is
// attached, `isEvalSupported` is off and XFA is disabled, so PDF JavaScript never runs.
export type PdfFailure = 'password_protected' | 'corrupt';

export class PdfReadError extends Error {
  override name = 'PdfReadError';

  constructor(
    readonly reason: PdfFailure,
    cause?: unknown,
  ) {
    super(`pdf unreadable: ${reason}`, { cause });
  }
}

export interface PdfPageText {
  pageNo: number;
  text: string;
}

export const PDF_OPEN_OPTIONS = {
  enableXfa: false,
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  useWorkerFetch: false,
  stopAtErrors: false,
} as const;

function failureOf(error: unknown): PdfFailure {
  const name = error instanceof Error ? error.name : '';
  return name === 'PasswordException' ? 'password_protected' : 'corrupt';
}

/** Per-page text of a PDF. Throws `PdfReadError` for a password-protected or corrupt file. */
export async function readPdfText(data: Uint8Array): Promise<PdfPageText[]> {
  // Loaded on first use, so importing the package never pulls pdfjs in.
  const { getDocument, VerbosityLevel } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: data.slice(),
    verbosity: VerbosityLevel.ERRORS,
    ...PDF_OPEN_OPTIONS,
  });
  try {
    const doc = await task.promise;
    if (doc.numPages < 1) throw new PdfReadError('corrupt');
    const pages: PdfPageText[] = [];
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      pages.push({ pageNo, text });
      page.cleanup();
    }
    await doc.destroy();
    return pages;
  } catch (error) {
    if (error instanceof PdfReadError) throw error;
    throw new PdfReadError(failureOf(error), error);
  }
}
