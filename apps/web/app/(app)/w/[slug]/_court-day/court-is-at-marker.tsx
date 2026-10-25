'use client';
// The "court is at item N" control of a hall header (#59). The form loads in its own chunk, so the
// board's first paint does not carry it; it still renders on the server.
import dynamic from 'next/dynamic';

import type { CourtIsAtMarkerFormProps } from './court-is-at-marker-form.tsx';

const Form = dynamic(() =>
  import('./court-is-at-marker-form.tsx').then((m) => m.CourtIsAtMarkerForm),
);

export type CourtIsAtMarkerProps = CourtIsAtMarkerFormProps;

export function CourtIsAtMarker(props: CourtIsAtMarkerProps) {
  return <Form {...props} />;
}
