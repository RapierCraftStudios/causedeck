// Security and privacy page data (#91). Each control states one fact that is true of the system as
// designed in the architecture spike (§6) and the ADRs, with a "How we prove it" reference. Public
// pages are links; engineering references are named, not linked, because the repository is private.
// Claims that depend on work not yet shipped are worded as commitments and listed in the PR for
// counsel (#117).
import { resolveCopy, type CopyLocale } from '../lib/copy.ts';

export interface SecuritySection {
  id: string;
  title: string;
}

/** Order of the sections in content/security.mdx; the table of contents and a test follow it. */
export const SECURITY_SECTIONS: readonly SecuritySection[] = [
  { id: 'data-in-india', title: 'Data in India' },
  { id: 'ai-processing', title: 'AI processing' },
  { id: 'no-training', title: 'No training on your data' },
  { id: 'encryption-and-isolation', title: 'Encryption and isolation' },
  { id: 'you-stay-in-control', title: 'You stay in control' },
  { id: 'audit-and-retention', title: 'Audit and retention' },
  { id: 'export-and-delete', title: 'Export and delete' },
  { id: 'compliance', title: 'Compliance posture' },
  { id: 'sub-processors', title: 'Sub-processors' },
  { id: 'sources', title: 'Every fact shows its source' },
  { id: 'controls', title: 'Controls and how we prove them' },
];

export interface Proof {
  label: string;
  /** On-site path when the proof is a public page; absent for an engineering reference. */
  href?: string;
}

export interface Control {
  id: string;
  control: string;
  detail: string;
  proof: Proof;
}

export interface SecurityCopy {
  metaTitle: string;
  metaDescription: string;
  title: string;
  intro: string;
  tocLabel: string;
  proofHeading: string;
  controlHeading: string;
  detailHeading: string;
  controlsCaption: string;
  diagramTitle: string;
  diagramDescription: string;
  diagramLegend: string;
  diagramNodes: { device: string; app: string; ai: string; site: string };
  controls: Control[];
}

const en: SecurityCopy = {
  metaTitle: 'Security and privacy',
  metaDescription:
    'How CauseDeck protects advocates’ data: India-region hosting, India-only AI by default, per-workspace encryption, no training on customer data, audit, export and delete.',
  title: 'Security and privacy',
  intro:
    'CauseDeck holds privileged matter data for advocates. This page says what the software does to protect it, in plain terms, and how each statement can be checked.',
  tocLabel: 'On this page',
  proofHeading: 'How we prove it',
  controlHeading: 'Control',
  detailHeading: 'What it means',
  controlsCaption: 'Security controls and their proof',
  diagramTitle: 'Where your data goes',
  diagramDescription:
    'Your phone or laptop connects over TLS to the CauseDeck app and database on a server in India. The app calls AI providers through India-region endpoints only. The marketing site on Cloudflare Pages is separate and holds no tenant data.',
  diagramLegend: 'Dashed outline: stays in India',
  diagramNodes: {
    device: 'Your phone or laptop',
    app: 'CauseDeck app and database, server in India',
    ai: 'AI providers, India-region endpoints',
    site: 'This website on Cloudflare Pages: no tenant data',
  },
  controls: [
    {
      id: 'india-hosting',
      control: 'India-region hosting',
      detail: 'The app, database, files and email run on infrastructure in India.',
      proof: { label: 'Sub-processor list, with regions', href: '/legal/sub-processors/' },
    },
    {
      id: 'india-only-ai',
      control: 'India-only AI by default',
      detail:
        'Every workspace starts with India-only mode on. AI requests go to India-region endpoints.',
      proof: { label: 'AI disclosure', href: '/legal/ai-disclosure/' },
    },
    {
      id: 'encryption',
      control: 'Per-workspace encryption keys and crypto-erase',
      detail:
        'Documents and memory values are encrypted with a key for each workspace. Deleting a workspace destroys its key, so what remains cannot be read.',
      proof: { label: 'Engineering reference: ADR 0006, envelope encryption' },
    },
    {
      id: 'isolation',
      control: 'Workspace isolation',
      detail:
        'The database enforces row-level isolation between workspaces, and a cross-tenant test suite that blocks every code change runs against it.',
      proof: { label: 'Engineering reference: tenancy and the cross-tenant suite' },
    },
    {
      id: 'two-factor',
      control: 'Two-factor authentication for owners',
      detail: 'Workspace owners sign in with a second factor.',
      proof: { label: 'Engineering reference: authentication design' },
    },
    {
      id: 'ai-audit',
      control: 'Audit of every AI call',
      detail:
        'Each AI call is recorded with its purpose and cost against the workspace. Matter content is kept out of logs.',
      proof: { label: 'Engineering reference: ADR 0007, AI gateway' },
    },
    {
      id: 'no-training',
      control: 'No training on customer data',
      detail:
        'AI providers are used only under terms that exclude training on your content. CauseDeck does not train models on it either.',
      proof: { label: 'AI disclosure', href: '/legal/ai-disclosure/' },
    },
    {
      id: 'undo',
      control: '7-day undo',
      detail:
        'Changes the software makes on your behalf are listed in an activity feed and can be undone for seven days. Nothing is sent or filed without you.',
      proof: { label: 'Engineering reference: ADR 0023, automation ladder and undo' },
    },
    {
      id: 'export-delete',
      control: 'Export and delete',
      detail:
        'Owners can export the workspace and delete it. Deletion has a 14-day cool-off, then the workspace key is destroyed.',
      proof: { label: 'Engineering reference: data lifecycle' },
    },
  ],
};

export const SECURITY_COPY: Record<CopyLocale, Partial<SecurityCopy>> & { en: SecurityCopy } = {
  en,
  ta: {},
  kn: {},
};

export function securityCopy(locale: CopyLocale = 'en'): SecurityCopy {
  return resolveCopy<SecurityCopy>(SECURITY_COPY, locale);
}
