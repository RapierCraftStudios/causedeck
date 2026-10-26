'use client';

// SSO settings loading state (#683): skeleton card, shared with the page's Suspense fallback.
import { SsoSkeleton } from './sso-form.tsx';

export default function SsoLoading() {
  return <SsoSkeleton />;
}
