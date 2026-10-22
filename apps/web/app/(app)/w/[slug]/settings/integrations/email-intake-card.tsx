'use client';
// The private email intake address card (#287): `intake+<token>@<domain>`, gated by the
// `capture.email-forward` flag. What the address does is the Capture milestone (#54).
import { IntegrationCard, type IntegrationCardProps } from './integration-card.tsx';

export function EmailIntakeCard(props: Omit<IntegrationCardProps, 'kind'>) {
  return <IntegrationCard kind="email_intake" {...props} />;
}
