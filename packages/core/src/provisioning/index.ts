// Bulk seat provisioning (#684, part of #508): CSV runs with a dry run, SCIM tokens and the SCIM v2
// Users service behind `apps/web/app/api/scim`. Imports audit and workspaces through their
// `index.ts`; it is a subpath export (`@causedeck/core/provisioning`), not part of the root index.
export {
  DEFAULT_PROVISIONING_ROLE,
  MAX_PROVISIONING_ROWS,
  parseProvisioningCsv,
  type ParsedProvisioningCsv,
  type ProvisioningCsvError,
  type ProvisioningCsvRow,
  type ProvisioningRole,
} from './csv.ts';
export {
  provisionFromCsv,
  type ProvisionFromCsvRequest,
  type ProvisioningReport,
  type ProvisioningReportRow,
  type ProvisioningRowOutcome,
  type ProvisioningRowReason,
} from './provision.ts';
export {
  createScimUser,
  deleteScimUser,
  getScimUser,
  handleScim,
  listScimUsers,
  patchScimUser,
  replaceScimUser,
  SCIM_ERROR_SCHEMA,
  SCIM_LIST_SCHEMA,
  SCIM_PATCH_SCHEMA,
  SCIM_USER_SCHEMA,
  ScimError,
  scimError,
  scimServiceProviderConfig,
  type ListScimUsersQuery,
  type ScimResult,
  type ScimUser,
} from './scim.ts';
export {
  authenticateScimToken,
  createScimToken,
  generateScimToken,
  hashScimToken,
  listScimTokens,
  revokeScimToken,
  SCIM_TOKEN_PATTERN,
  type CreatedScimToken,
  type CreateScimTokenInput,
  type ScimIdentity,
  type ScimTokenSummary,
} from './scim-token.ts';
