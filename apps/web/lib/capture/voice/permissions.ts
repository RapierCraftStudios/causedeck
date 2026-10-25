// Microphone access for the voice recorder (#543). Asked for only when the person starts a
// recording from the sheet and stopped the moment the recording ends or the sheet closes (no
// background recording). Where it is unavailable or denied the sheet says how to enable it.

export const MICROPHONE_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true },
  video: false,
};

export type MicrophoneStart =
  | { kind: 'stream'; stream: MediaStream }
  /** No `getUserMedia` (insecure context, old browser) or no microphone. */
  | { kind: 'unavailable' }
  /** The person said no, or the OS blocks it: show how to enable it. */
  | { kind: 'denied' }
  | { kind: 'error' };

/** The part of `navigator` the recorder needs; absent in an insecure context or an old browser. */
type MicrophoneNavigator = { mediaDevices?: Pick<MediaDevices, 'getUserMedia'> | undefined };

export function microphoneSupported(nav: MicrophoneNavigator = globalThis.navigator): boolean {
  return typeof nav.mediaDevices?.getUserMedia === 'function';
}

/** Ask for the microphone. Never throws; the kind says what happened. */
export async function startMicrophone(
  nav: MicrophoneNavigator = globalThis.navigator,
): Promise<MicrophoneStart> {
  const devices = nav.mediaDevices;
  if (devices === undefined) return { kind: 'unavailable' };
  try {
    return { kind: 'stream', stream: await devices.getUserMedia(MICROPHONE_CONSTRAINTS) };
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return { kind: 'denied' };
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return { kind: 'unavailable' };
    return { kind: 'error' };
  }
}

export function stopMicrophone(stream: MediaStream | null | undefined): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}
