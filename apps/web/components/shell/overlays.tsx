'use client';

import dynamic from 'next/dynamic';

import { InstallBanner } from '../pwa/install-banner.tsx';
import { UpdateToast } from '../pwa/update-toast.tsx';

// The camera sheet (#52) opens on `?capture=camera` and stays a chunk of its own.
const CameraHost = dynamic(
  () => import('../capture/camera/camera-sheet.tsx').then((m) => m.CameraHost),
  { ssr: false },
);

// The voice recorder (#543) opens on `?capture=voice`, also a chunk of its own.
const VoiceHost = dynamic(
  () => import('../capture/voice/voice-recorder-sheet.tsx').then((m) => m.VoiceHost),
  { ssr: false },
);

export interface ShellOverlaysProps {
  viewerId: string;
  workspaceId: string;
}

/** The topbar's floating stack: update toast (#50), camera sheet (#52), voice recorder (#543) and install banner (#50). */
export function ShellOverlays({ viewerId, workspaceId }: ShellOverlaysProps) {
  return (
    <>
      <UpdateToast />
      <CameraHost workspaceId={workspaceId} />
      <VoiceHost workspaceId={workspaceId} />
      <InstallBanner viewerId={viewerId} workspaceId={workspaceId} />
    </>
  );
}
