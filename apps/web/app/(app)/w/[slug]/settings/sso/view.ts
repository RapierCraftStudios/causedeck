// What the SSO settings page may know about a provider (#683): never its settings (client secret,
// certificate), only the summary fields below.
import type { SsoProviderSummary } from '@causedeck/core/workspaces';

export type SsoProviderView = Omit<SsoProviderSummary, 'createdAt' | 'updatedAt'>;

/** The fields the page may see; never the provider's settings. */
export function toView(row: SsoProviderSummary): SsoProviderView {
  return {
    id: row.id,
    protocol: row.protocol,
    issuer: row.issuer,
    domain: row.domain,
    enabled: row.enabled,
    domainVerified: row.domainVerified,
    domainVerification: row.domainVerification,
  };
}
