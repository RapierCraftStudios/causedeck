// Public sub-processor list (#95). Data only: the page, the RSS feed and the manifest parity test
// (lib/legal.test.ts against infra/sub-processors.json) all read it. Keep ids in step with the
// manifest. Dates are the day the entry took effect; update `effectiveDate` on a material change so
// the feed announces it.

export interface Subprocessor {
  id: string;
  name: string;
  purpose: string;
  dataCategories: string[];
  region: string;
  /** Provider's public site; omitted while the provider is not yet chosen. */
  url?: string;
  effectiveDate: string;
}

export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    id: 'hosting-vps',
    name: 'Hosting provider (VPS, India region)',
    purpose: 'Runs the application, API, worker and database.',
    dataCategories: ['Account data', 'Workspace content', 'Logs'],
    region: 'India',
    effectiveDate: '2026-10-25',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    purpose: 'Serves this static site and answers DNS. The product app is not proxied.',
    dataCategories: ['IP address and request metadata of site visitors'],
    region: 'Global edge network (no customer content)',
    url: 'https://www.cloudflare.com',
    effectiveDate: '2026-10-25',
  },
  {
    id: 'aws-ses',
    name: 'Amazon Web Services: SES',
    purpose: 'Sends sign-in links and product notifications by email.',
    dataCategories: ['Email address', 'Message content of notifications'],
    region: 'India (ap-south-1)',
    url: 'https://aws.amazon.com/ses/',
    effectiveDate: '2026-10-25',
  },
  {
    id: 'aws-bedrock',
    name: 'Amazon Web Services: Bedrock',
    purpose: 'Runs language models that propose drafts and summaries for the lawyer to confirm.',
    dataCategories: ['Workspace content sent in a request'],
    region: 'India (India inference profile)',
    url: 'https://aws.amazon.com/bedrock/',
    effectiveDate: '2026-10-25',
  },
  {
    id: 'sarvam',
    name: 'Sarvam',
    purpose: 'Speech-to-text, OCR and Indic-language processing.',
    dataCategories: ['Audio and documents sent in a request'],
    region: 'India',
    url: 'https://www.sarvam.ai',
    effectiveDate: '2026-10-25',
  },
  {
    id: 'indian-kanoon',
    name: 'Indian Kanoon',
    purpose: 'Link-outs to judgments and checks that a cited judgment exists.',
    dataCategories: ['Citation text used in a check'],
    region: 'India',
    url: 'https://indiankanoon.org',
    effectiveDate: '2026-10-25',
  },
  {
    id: 'razorpay',
    name: 'Razorpay',
    purpose: 'Takes subscription payments.',
    dataCategories: ['Billing contact', 'Payment references'],
    region: 'India',
    url: 'https://razorpay.com',
    effectiveDate: '2026-10-25',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    purpose: 'Collects error reports so faults can be fixed.',
    dataCategories: ['Error details', 'Pseudonymous user and workspace identifiers'],
    // TODO(counsel): confirm the Sentry project region before this page is published.
    region: 'To be confirmed',
    url: 'https://sentry.io',
    effectiveDate: '2026-10-25',
  },
];
