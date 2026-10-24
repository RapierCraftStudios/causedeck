// The camera's way into the command palette (#52): "Photograph a diary page" opens the camera
// sheet. The palette runs the command by navigating to `?capture=camera`, which the shell's
// camera host (`CameraHost`) watches, so it works from any screen.
import { Camera } from 'lucide-react';

import { commandsSnapshot, registerCommands } from '../../commands/registry.ts';

export const CAMERA_COMMAND_ID = 'capture.camera';
export const CAMERA_QUERY_KEY = 'capture';
export const CAMERA_QUERY_VALUE = 'camera';

/** `href` with `?capture=camera` added. */
export function cameraHref(href: string): string {
  const [path = '', hash = ''] = href.split('#');
  const [base = '', query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set(CAMERA_QUERY_KEY, CAMERA_QUERY_VALUE);
  return `${base}?${params.toString()}${hash === '' ? '' : `#${hash}`}`;
}

/** Whether the search params ask for the camera sheet. */
export function wantsCamera(search: string | URLSearchParams): boolean {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return params.get(CAMERA_QUERY_KEY) === CAMERA_QUERY_VALUE;
}

/** Register the command unless it already is. Returns the remover. */
export function registerCameraCommand(currentHref: () => string): () => void {
  if (commandsSnapshot().some((entry) => entry.id === CAMERA_COMMAND_ID)) return () => undefined;
  return registerCommands('create', [
    {
      id: CAMERA_COMMAND_ID,
      labelKey: 'camera.command',
      icon: Camera,
      keywords: ['photo', 'diary', 'camera', 'scan'],
      requires: 'document.write',
      perform: (ctx) => {
        ctx.navigate(cameraHref(currentHref()));
      },
    },
  ]);
}
