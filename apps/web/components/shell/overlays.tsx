'use client';

import dynamic from 'next/dynamic';

import { InstallBanner } from '../pwa/install-banner.tsx';
import { UpdateToast } from '../pwa/update-toast.tsx';

// The camera sheet (#52) opens on `?capture=camera` and stays a chunk of its own.
const CameraHost = dynamic(
  () => import('../capture/camera/camera-sheet.tsx').then((m) => m.CameraHost),
  { ssr: false },
);

export interface ShellOverlaysProps {
  viewerId: string;
  workspaceId: string;
}

/** The topbar's floating stack: update toast (#50), camera sheet (#52) and install banner (#50). */
export function ShellOverlays({ viewerId, workspaceId }: ShellOverlaysProps) {
  return (
    <>
      <UpdateToast />
      <CameraHost workspaceId={workspaceId} />
      <InstallBanner viewerId={viewerId} workspaceId={workspaceId} />
    </>
  );
}
