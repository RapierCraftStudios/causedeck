// Camera access for the diary-photo sheet (#52). The rear camera through `getUserMedia`, asked for
// only when the sheet opens and stopped the moment it closes (no background capture); where it is
// unavailable or denied the sheet falls back to `<input type="file" accept="image/*"
// capture="environment">`, and the gallery picker is always offered.

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: { ideal: 'environment' } },
  audio: false,
};

export type CameraStart =
  | { kind: 'stream'; stream: MediaStream }
  /** No `getUserMedia` (insecure context, old browser): use the file input. */
  | { kind: 'unavailable' }
  /** The person said no, or the OS blocks it: show how to enable it, offer the gallery. */
  | { kind: 'denied' }
  | { kind: 'error' };

/** The part of `navigator` the camera needs; absent in an insecure context or an old browser. */
type CameraNavigator = { mediaDevices?: Pick<MediaDevices, 'getUserMedia'> | undefined };

export function cameraSupported(nav: CameraNavigator = globalThis.navigator): boolean {
  return typeof nav.mediaDevices?.getUserMedia === 'function';
}

/** Ask for the rear camera. Never throws; the kind says what happened. */
export async function startCamera(
  nav: CameraNavigator = globalThis.navigator,
): Promise<CameraStart> {
  const devices = nav.mediaDevices;
  if (devices === undefined) return { kind: 'unavailable' };
  try {
    return { kind: 'stream', stream: await devices.getUserMedia(CAMERA_CONSTRAINTS) };
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return { kind: 'denied' };
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return { kind: 'unavailable' };
    return { kind: 'error' };
  }
}

export function stopCamera(stream: MediaStream | null | undefined): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** One full-resolution frame of the live video as a JPEG. */
export function grabFrame(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (context === null || canvas.width === 0) return Promise.reject(new Error('no_frame'));
  context.drawImage(video, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) reject(new Error('no_frame'));
        else resolve(blob);
      },
      'image/jpeg',
      0.95,
    );
  });
}
