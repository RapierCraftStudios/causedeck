// Research providers (#80, D-048): where a research link may point. A provider is a label, an
// `https` URL template with one `{q}` placeholder and the host that template fixes. Built-in
// providers are the free public search pages; SCC Online and Manupatra exist only as a workspace's
// own template (a lawyer's subscription), never as a default. Nothing here fetches a page: the
// product assembles a link and the lawyer opens it in a new window (PX-6, PX-8).

export interface ResearchProvider {
  key: string;
  label: string;
  /** `https://host/path?q={q}`; `{q}` is replaced by the encoded query. */
  urlTemplate: string;
  /** The only host a link built from this provider may have. */
  host: string;
}

export const QUERY_PLACEHOLDER = '{q}';

export type TemplateCheck = { ok: true; host: string } | { ok: false; reason: string };

/**
 * A provider template is acceptable when it is an absolute `https` URL with a plain host (no
 * userinfo, no port, no placeholder in the host), contains `{q}`, and no backslash or whitespace.
 * `javascript:`, `data:` and every other scheme fail. The returned host is the template's own host,
 * which `buildResearchLinks` enforces on every link it builds.
 */
export function validateProviderTemplate(template: string): TemplateCheck {
  if (typeof template !== 'string' || template.length === 0 || template.length > 500) {
    return { ok: false, reason: 'Enter a link of up to 500 characters' };
  }
  if (/[\s\\]/.test(template)) return { ok: false, reason: 'The link has spaces or backslashes' };
  if (!template.includes(QUERY_PLACEHOLDER)) {
    return { ok: false, reason: 'Include {q} where the query goes' };
  }
  let url: URL;
  try {
    url = new URL(template);
  } catch {
    return { ok: false, reason: 'Enter a full https link' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'Only https links are allowed' };
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'The link may not contain a user name or password' };
  }
  if (url.port !== '') return { ok: false, reason: 'The link may not name a port' };
  if (url.hostname === '' || !url.hostname.includes('.')) {
    return { ok: false, reason: 'Enter a link to a public site' };
  }
  // The placeholder must sit after the host: the host is the template's, never the query's.
  const afterHost = template.slice(template.indexOf(url.hostname) + url.hostname.length);
  if (!afterHost.includes(QUERY_PLACEHOLDER)) {
    return { ok: false, reason: 'Put {q} in the path or query, not the host' };
  }
  return { ok: true, host: url.hostname };
}

const builtIn = (key: string, label: string, urlTemplate: string): ResearchProvider => ({
  key,
  label,
  urlTemplate,
  host: new URL(urlTemplate).hostname,
});

/** The free public search pages every workspace gets. */
export const BUILT_IN_PROVIDERS: readonly ResearchProvider[] = [
  builtIn('indian-kanoon', 'Indian Kanoon', 'https://indiankanoon.org/search/?formInput={q}'),
  builtIn('supreme-court', 'Supreme Court of India judgments', 'https://www.sci.gov.in/?s={q}'),
  builtIn(
    'high-courts',
    'High Court judgments (eCourts)',
    'https://judgments.ecourts.gov.in/pdfsearch/?search_text={q}',
  ),
];

/** A workspace's own template as a provider; null when the template is not acceptable. */
export function providerFromTemplate(row: {
  key: string;
  label: string;
  urlTemplate: string;
}): ResearchProvider | null {
  const check = validateProviderTemplate(row.urlTemplate);
  if (!check.ok) return null;
  return { key: row.key, label: row.label, urlTemplate: row.urlTemplate, host: check.host };
}
