// The capture domain (#43; PRD CA-1..CA-4, CA-9, CA-10; docs/product/09 §3, §5, §8): the capture
// inbox model and upload pipeline. `createCapture` / `completeUpload` take a file through the
// allow-list, size caps, de-duplication, scan hook and sensitive-matter gate; channels are opt-in
// (`enableChannel`); `discardCapture` / `pinCapture` manage the raw object's life; the job bodies
// (`runCaptureScan`, `runCaptureProcess`, `sweepExpiredCaptures`) are wrapped by
// `jobs/definitions/capture-*.ts`. Pure rules (allow-list, status machine, TTL maths, scanners)
// live in `@causedeck/capture`. The domain never imports `jobs`: producers arrive as `CaptureJobs`.
export {
  assertChannelEnabled,
  CAPTURE_DISCLOSURE_VERSION,
  disableChannel,
  enableChannel,
  isChannelEnabled,
  listChannels,
  type ChannelState,
  type EnableChannelInput,
} from './channels.ts';
export { captureConfigFromProcess } from './env.ts';
export type { CaptureAction, CaptureCtx, CaptureJobDeps, CaptureJobs } from './context.ts';
export {
  completeUpload,
  createCapture,
  createManualCapture,
  type CompletedCapture,
  type CreatedCapture,
  type ManualCaptureInput,
} from './create.ts';
export {
  ChannelDisabledError,
  isCaptureDomainError,
  SensitiveMatterExcludedError,
} from './errors.ts';
export {
  createKeyLineCapture,
  discardCapture,
  keepCaptureAsAttachment,
  pinCapture,
} from './manage.ts';
export {
  aiStepsAllowed,
  closeReviewedCapture,
  finishCapture,
  runCapturePipeline,
  runCaptureProcess,
  type CapturePipelineDeps,
  type CapturePipelineOutcome,
  type CaptureProcessOutcome,
} from './process.ts';
export {
  markCaptureFailed,
  RETENTION_BATCH,
  setExtractionTtl,
  sweepExpiredCaptures,
} from './retention.ts';
export { runCaptureScan, ScanUnavailableError, type CaptureScanOutcome } from './scan.ts';
export type { CaptureRecord } from './state.ts';
