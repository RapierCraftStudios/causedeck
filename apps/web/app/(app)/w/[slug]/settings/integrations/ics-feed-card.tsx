'use client';
// The private ICS feed URL card (#287): `<app>/api/ics/<token>`, gated by the `capture.ics-feed`
// flag. The feed itself is the Capture milestone (#53).
import { IntegrationCard, type IntegrationCardProps } from './integration-card.tsx';

export function IcsFeedCard(props: Omit<IntegrationCardProps, 'kind'>) {
  return <IntegrationCard kind="ics_feed" {...props} />;
}
