// The pipeline version and its defaults. The version is part of the idempotency key
// `(sha256, pipelineVersion)`: bump it when the pipeline's output changes, and captures are
// re-processed on demand only (a new `capture.process` job), never automatically.
export const PIPELINE_VERSION = 'di-1';

export interface PipelineOptions {
  /** A page with fewer normalised characters than this is OCRed (default 40). */
  minPageChars: number;
  /** OCR pages under this confidence are `lowConfidencePages` and send the capture to Needs you. */
  confidenceFloor: number;
  /** Simhash Hamming distance at or under which two texts are near-duplicates. */
  nearDuplicateDistance: number;
  /** Pages OCRed at the same time. */
  ocrBatchSize: number;
}

export const DEFAULT_PIPELINE_OPTIONS: PipelineOptions = {
  minPageChars: 40,
  confidenceFloor: 0.6,
  nearDuplicateDistance: 3,
  ocrBatchSize: 4,
};
