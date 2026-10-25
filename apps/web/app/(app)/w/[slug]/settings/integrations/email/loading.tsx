'use client';

// Email intake loading state (#54): skeleton cards for the channel, address and allow-list. The
// route's `loading.tsx`; the page's Suspense fallback uses the same `EmailIntakeSkeleton`.
import { EmailIntakeSkeleton } from '../../../../../../../components/settings/email/email-skeleton.tsx';

export default function EmailIntakeLoading() {
  return <EmailIntakeSkeleton />;
}
