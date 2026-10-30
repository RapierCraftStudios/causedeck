import { contactEmail } from '../../lib/landing.ts';
import { pageMetadata } from '../../lib/seo.ts';

export const metadata = pageMetadata({
  title: 'Contact',
  description: 'Write to the CauseDeck team by email. There is no form and nothing is collected.',
  path: 'contact',
});

export default function ContactPage() {
  const email = contactEmail();
  return (
    <section aria-labelledby="contact-title" className="mx-auto max-w-[68ch] py-8">
      <h1 id="contact-title" className="text-ink font-serif text-3xl font-semibold">
        Contact
      </h1>
      <p className="text-ink-muted mt-4 text-lg">
        Write to us at{' '}
        <a className="text-accent underline" href={`mailto:${email}`}>
          {email}
        </a>
        . There is no form on this site, and it sets no cookies.
      </p>
    </section>
  );
}
