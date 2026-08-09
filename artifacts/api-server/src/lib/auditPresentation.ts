export const ACTIVE_AUDIT_SOURCE = "active_v2" as const;
export const LEGACY_AUDIT_SOURCE = "legacy_v1_archive" as const;
export const ACTIVE_AUDIT_INTEGRITY = "active_v2_record" as const;

export type LegacyAuditIntegrity =
  | "payload_hash_verified"
  | "known_discontinuity";

interface AuditEventPresentationShape {
  id: string;
  createdAt: string;
}

/**
 * Presents current and preserved audit rows without implying that the legacy
 * archive belongs to, or verifies as part of, the active tenant chain.
 */
export function mergeAuditEventPresentations<
  Active extends AuditEventPresentationShape,
  Legacy extends AuditEventPresentationShape & {
    integrityStatus: LegacyAuditIntegrity;
  },
>(active: Active[], archived: Legacy[]) {
  return [
    ...active.map((row) => ({
      ...row,
      auditSource: ACTIVE_AUDIT_SOURCE,
      integrityStatus: ACTIVE_AUDIT_INTEGRITY,
    })),
    ...archived.map((row) => ({
      ...row,
      auditSource: LEGACY_AUDIT_SOURCE,
      integrityStatus: row.integrityStatus,
    })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
