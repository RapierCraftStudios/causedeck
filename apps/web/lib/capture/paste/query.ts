// The capture sheet's `Paste text` action opens the paste sheet on `?capture=paste`, like the
// voice recorder (`?capture=voice`) and the camera (`?capture=camera`).
export const PASTE_QUERY_KEY = 'capture';
export const PASTE_QUERY_VALUE = 'paste';

/** Whether the URL asks for the paste sheet. */
export function wantsPaste(search: string | URLSearchParams): boolean {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return params.get(PASTE_QUERY_KEY) === PASTE_QUERY_VALUE;
}
