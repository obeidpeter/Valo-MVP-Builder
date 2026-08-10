/**
 * Independent evidence transactions may use a second pooled connection, but
 * they never gain authority to select a different tenant than the ambient
 * request. No ambient context is permitted for operational callers that are
 * establishing their first tenant-scoped transaction.
 */
export function assertIndependentTenantContext(
  activeOrganisationId: string | undefined,
  requestedOrganisationId: string,
): void {
  if (
    activeOrganisationId !== undefined &&
    activeOrganisationId !== requestedOrganisationId
  ) {
    throw new Error("Cross-tenant database context nesting is prohibited");
  }
}
