# Processor Registry

This document records third-party processors that handle personal data on behalf of CauseDeck, per D-009 (India residency) and DPDP Act requirements. Production clearance for any source is blocked until the relevant processor entry is complete and a signed DPA is on file.

## AlterLab

- **Processor name:** AlterLab
- **Purpose:** Processing court pages and notices that contain personal data (scraping, parsing, and extraction of court records).
- **Data categories:** Court pages, hearing notices, case records, and any personal data contained therein (names, addresses, case numbers, party details).
- **Processing location:** India egress enforced via `proxyCountry: 'IN'`. Request and response data processed within India.
- **Storage location:** India. Request/response payloads and extracted records stored in India-region infrastructure.
- **Log retention:** Request and response logs retained for a maximum of 30 days, then purged. Extracted records retained per source-specific retention policy.
- **Sub-processors:** None declared. Any change to sub-processors requires prior written notice and re-approval.
- **DPA status:** Signed processor terms (DPA) on file. Reference: `DPA-ALTERLAB-2024-001` (executed, stored in legal records).
- **Residency confirmation:** Written confirmation of processing and storage location and log retention received and filed. See legal records ref `RESIDENCY-ALTERLAB-2024-001`.
- **Production clearance:** Blocked until DPA and residency confirmation are verified — completed. Source may be cleared for production subject to ongoing compliance review.

## Status

| Processor | DPA on file | Residency confirmed | Production cleared |
|-----------|-------------|---------------------|--------------------|
| AlterLab  | Yes         | Yes                 | Yes                |