import { Hero } from '../components/landing/hero.tsx';
import {
  CourtsSection,
  CtaBand,
  Faq,
  LoopSection,
  ProblemStrip,
  ProvenanceSection,
  TrustSection,
} from '../components/landing/sections.tsx';
import { signInHref } from '../lib/landing.ts';
import { pageMetadata, softwareApplicationJsonLd } from '../lib/seo.ts';

export const metadata = pageMetadata({
  title: 'Software for advocates',
  description:
    'CauseDeck is software for advocates. It reads your cause lists and orders, builds tomorrow’s briefs and tracks every direction you owe.',
  path: '',
});

export default function HomePage() {
  const href = signInHref();
  return (
    <>
      <Hero signInHref={href} />
      <ProblemStrip />
      <LoopSection />
      <ProvenanceSection />
      <TrustSection />
      <CourtsSection />
      <Faq />
      <CtaBand signInHref={href} />
      {/* nosemgrep: infra.security.semgrep.causedeck.unsafe-html-injection -- JSON-LD from static first-party data, no user input */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd()) }}
      />
    </>
  );
}
