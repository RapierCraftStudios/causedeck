// The voice recorder's way into the command palette (#543): "Record a voice note" opens the
// recorder sheet. The palette runs the command by navigating to `?capture=voice`, which the
// shell's voice host (`VoiceHost`) watches, so it works from any screen. The shell's Capture button
// links to the same address.
import { Mic } from 'lucide-react';

import { commandsSnapshot, registerCommands } from '../../commands/registry.ts';

export const VOICE_COMMAND_ID = 'capture.voice';
export const VOICE_QUERY_KEY = 'capture';
export const VOICE_QUERY_VALUE = 'voice';
/** A listing's matter, carried over so the recording is linked to it when opened from there. */
export const VOICE_MATTER_KEY = 'matter';

/** `href` with `?capture=voice` added. */
export function voiceHref(href: string): string {
  const [path = '', hash = ''] = href.split('#');
  const [base = '', query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set(VOICE_QUERY_KEY, VOICE_QUERY_VALUE);
  return `${base}?${params.toString()}${hash === '' ? '' : `#${hash}`}`;
}

/** Whether the search params ask for the recorder sheet. */
export function wantsVoice(search: string | URLSearchParams): boolean {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return params.get(VOICE_QUERY_KEY) === VOICE_QUERY_VALUE;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The matter to prefill, only when `?matter=` is a valid id. */
export function matterFromSearch(search: string | URLSearchParams): string | undefined {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const id = params.get(VOICE_MATTER_KEY);
  return id !== null && UUID.test(id) ? id : undefined;
}

/** Register the command unless it already is. Returns the remover. */
export function registerVoiceCommand(currentHref: () => string): () => void {
  if (commandsSnapshot().some((entry) => entry.id === VOICE_COMMAND_ID)) return () => undefined;
  return registerCommands('create', [
    {
      id: VOICE_COMMAND_ID,
      labelKey: 'voice.command',
      icon: Mic,
      keywords: ['voice', 'record', 'audio', 'dictate', 'note'],
      requires: 'document.write',
      perform: (ctx) => {
        ctx.navigate(voiceHref(currentHref()));
      },
    },
  ]);
}
