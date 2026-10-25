/** Templates, block engine, DOCX/PDF export and narrative drafting. Nothing here sends, files or submits. */
export const packageName: string = '@causedeck/drafting';

export * from './blocks';
export {
  draftNarrative,
  NarrativeOutputError,
  type NarrativeContext,
  type NarrativePort,
} from './narrative';
export * from './presets/index';
export { MissingSlotsError, type NarrativeText, type RenderOptions } from './render/common';
export { renderDocx } from './render/docx';
export { PdfTooLargeError, renderPdf, type PdfOptions } from './render/pdf';
export {
  exportBlockers,
  factsForPrompt,
  missingMarker,
  resolveBlocks,
  resolveSlot,
  type Facts,
  type Provenance,
  type Resolution,
} from './slots';
