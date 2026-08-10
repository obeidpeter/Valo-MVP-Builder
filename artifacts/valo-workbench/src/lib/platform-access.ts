export const PLATFORM_ROLES = [
  "admin",
  "reviewer",
  "analyst",
  "none",
  "client_owner",
  "client_admin",
  "bid_manager",
  "contributor",
  "client_reviewer",
  "client_auditor",
  "valo_analyst",
  "valo_quality_adviser",
  "valo_operations_admin",
  "platform_admin_restricted",
  "partner_admin",
  "partner_analyst",
  "partner_reviewer",
  "client_organisation_owner",
  "client_administrator",
  "client_reviewer_approver",
  "valo_operations_administrator",
  "restricted_platform_administrator",
  "consultancy_partner_administrator",
  "consultancy_partner_analyst_reviewer",
  "read_only_auditor",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export type PlatformRoleInput = string | readonly string[] | null | undefined;

export type PlatformArea =
  | "workbench"
  | "pursuit_workbench"
  | "operations"
  | "client_portal"
  | "partner_workspace"
  | "evidence_readiness"
  | "billing_entitlements"
  | "notifications"
  | "security_audit"
  | "organisation_settings"
  | "settings";

export type CommercialFeature =
  | "clientPortal"
  | "partnerWorkspace"
  | "billingEntitlements"
  | "notificationAdapters";

export interface PlatformFeatureFlags {
  clientPortal: boolean;
  partnerWorkspace: boolean;
  billingEntitlements: boolean;
  notificationAdapters: boolean;
}

export interface PlatformAccessDecision {
  area: PlatformArea;
  allowed: boolean;
  enabled: boolean;
  state: "active" | "pending_activation" | "denied";
  reason: string;
}

export interface PlatformNavItem {
  href: string;
  label: string;
  area: PlatformArea;
  group: "Workspace" | "Delivery" | "Oversight" | "Administration";
  feature?: CommercialFeature;
  requiredPermission?: string;
  requiredPermissions?: readonly string[];
}

export const INTELLIGENCE_READ_PERMISSIONS = [
  "client:read",
  "project:read",
  "document:read",
  "requirement:read",
  "evidence:read",
  "defect:read",
  "report:read",
  "draft:read",
  "package:read",
  "evaluation:read",
] as const;

const CLIENT_ROLES = new Set<PlatformRole>([
  "client_owner",
  "client_admin",
  "bid_manager",
  "contributor",
  "client_reviewer",
  "client_organisation_owner",
  "client_administrator",
  "client_reviewer_approver",
]);

const PARTNER_ROLES = new Set<PlatformRole>([
  "partner_admin",
  "partner_analyst",
  "partner_reviewer",
  "consultancy_partner_administrator",
  "consultancy_partner_analyst_reviewer",
]);

const INTERNAL_ROLES = new Set<PlatformRole>([
  "admin",
  "reviewer",
  "analyst",
  "valo_analyst",
  "valo_quality_adviser",
  "valo_operations_admin",
  "valo_operations_administrator",
]);

const ADMIN_ROLES = new Set<PlatformRole>([
  "admin",
  "valo_operations_admin",
  "platform_admin_restricted",
  "valo_operations_administrator",
  "restricted_platform_administrator",
]);

const SETTINGS_ROLES = new Set<PlatformRole>([
  "admin",
  "valo_operations_admin",
  "valo_operations_administrator",
]);

const QUALITY_ROLES = new Set<PlatformRole>([
  "admin",
  "reviewer",
  "analyst",
  "valo_analyst",
  "valo_quality_adviser",
  "valo_operations_admin",
  "client_owner",
  "client_admin",
  "bid_manager",
  "client_reviewer",
  "client_auditor",
  "partner_admin",
  "partner_analyst",
  "partner_reviewer",
  "client_organisation_owner",
  "client_administrator",
  "client_reviewer_approver",
  "consultancy_partner_administrator",
  "consultancy_partner_analyst_reviewer",
  "read_only_auditor",
]);

const AREA_ROLES: Record<PlatformArea, ReadonlySet<PlatformRole>> = {
  workbench: INTERNAL_ROLES,
  // These roles carry project/requirement/evidence/report read permissions in
  // their selected server-authorised context. Related client contexts are
  // listed only after the backend validates the partner membership,
  // relationship lifecycle and commercial activation; the client is never
  // inferred from the role.
  pursuit_workbench: new Set<PlatformRole>([
    ...INTERNAL_ROLES,
    ...CLIENT_ROLES,
    ...PARTNER_ROLES,
    "read_only_auditor",
    "client_auditor",
  ]),
  operations: INTERNAL_ROLES,
  client_portal: new Set<PlatformRole>(["admin", ...CLIENT_ROLES]),
  partner_workspace: new Set<PlatformRole>(["admin", ...PARTNER_ROLES]),
  evidence_readiness: QUALITY_ROLES,
  billing_entitlements: new Set<PlatformRole>([
    "admin",
    "valo_operations_admin",
    "valo_operations_administrator",
    "client_owner",
    "client_admin",
    "partner_admin",
    "client_organisation_owner",
    "client_administrator",
    "consultancy_partner_administrator",
  ]),
  notifications: new Set<PlatformRole>([
    ...INTERNAL_ROLES,
    ...CLIENT_ROLES,
    ...PARTNER_ROLES,
  ]),
  security_audit: new Set<PlatformRole>([
    ...ADMIN_ROLES,
    "read_only_auditor",
    "client_auditor",
  ]),
  organisation_settings: new Set<PlatformRole>([
    "admin",
    "valo_operations_admin",
    "valo_operations_administrator",
    "client_owner",
    "client_admin",
    "client_organisation_owner",
    "client_administrator",
    "partner_admin",
    "consultancy_partner_administrator",
  ]),
  settings: SETTINGS_ROLES,
};

const AREA_FEATURE: Partial<Record<PlatformArea, CommercialFeature>> = {
  client_portal: "clientPortal",
  partner_workspace: "partnerWorkspace",
  billing_entitlements: "billingEntitlements",
  notifications: "notificationAdapters",
};

const AREA_REQUIRED_PERMISSION: Partial<Record<PlatformArea, string>> = {
  workbench: "analytics:read",
  pursuit_workbench: "project:read",
  operations: "project:read",
  client_portal: "project:read",
  partner_workspace: "partner_relationship:read",
  evidence_readiness: "evidence:read",
  billing_entitlements: "entitlement:read",
  notifications: "project:read",
  security_audit: "audit:read",
  organisation_settings: "membership:manage",
  settings: "configuration:manage",
};

const NAV_ITEMS: PlatformNavItem[] = [
  {
    href: "/app",
    label: "Command Centre",
    area: "workbench",
    group: "Workspace",
    requiredPermission: "analytics:read",
  },
  {
    href: "/projects",
    label: "Pursuits",
    area: "pursuit_workbench",
    group: "Workspace",
    requiredPermission: "project:read",
  },
  {
    href: "/intelligence",
    label: "Intelligence Centre",
    area: "pursuit_workbench",
    group: "Workspace",
    requiredPermissions: INTELLIGENCE_READ_PERMISSIONS,
  },
  {
    href: "/portal",
    label: "Client workspace",
    area: "client_portal",
    group: "Workspace",
    feature: "clientPortal",
    requiredPermission: "project:read",
  },
  {
    href: "/partner",
    label: "Partner workspace",
    area: "partner_workspace",
    group: "Workspace",
    feature: "partnerWorkspace",
    requiredPermission: "partner_relationship:read",
  },
  {
    href: "/sbd",
    label: "Compliance",
    area: "pursuit_workbench",
    group: "Delivery",
    requiredPermission: "requirement:read",
  },
  {
    href: "/evidence-readiness",
    label: "Evidence Library",
    area: "evidence_readiness",
    group: "Delivery",
    requiredPermission: "evidence:read",
  },
  {
    href: "/operations",
    label: "Reviews",
    area: "operations",
    group: "Delivery",
    requiredPermission: "project:read",
  },
  {
    href: "/reports",
    label: "Reports",
    area: "pursuit_workbench",
    group: "Delivery",
    requiredPermission: "report:read",
  },
  {
    href: "/clients",
    label: "Clients",
    area: "pursuit_workbench",
    group: "Oversight",
    requiredPermission: "client:read",
  },
  {
    href: "/billing",
    label: "Billing & entitlements",
    area: "billing_entitlements",
    group: "Oversight",
    feature: "billingEntitlements",
    requiredPermission: "entitlement:read",
  },
  {
    href: "/notifications",
    label: "Notifications",
    area: "notifications",
    group: "Oversight",
    feature: "notificationAdapters",
    requiredPermission: "project:read",
  },
  {
    href: "/app/security",
    label: "Security & audit",
    area: "security_audit",
    group: "Administration",
    requiredPermission: "audit:read",
  },
  {
    href: "/organisation-settings",
    label: "Organisation Settings",
    area: "organisation_settings",
    group: "Administration",
    requiredPermission: "membership:manage",
  },
  {
    href: "/settings",
    label: "Platform Operations",
    area: "settings",
    group: "Administration",
    requiredPermission: "configuration:manage",
  },
];

function enabled(value: unknown): boolean {
  return typeof value === "string" && value.toLowerCase() === "true";
}

export function platformFeatureFlags(
  env: Record<string, unknown> = import.meta.env,
): PlatformFeatureFlags {
  return {
    clientPortal: enabled(env.VITE_FEATURE_CLIENT_PORTAL),
    partnerWorkspace: enabled(env.VITE_FEATURE_PARTNER_WORKSPACE),
    billingEntitlements: enabled(env.VITE_FEATURE_BILLING_ENTITLEMENTS),
    notificationAdapters: enabled(env.VITE_FEATURE_NOTIFICATION_ADAPTERS),
  };
}

export function normalizePlatformRole(
  role: string | null | undefined,
): PlatformRole | null {
  return PLATFORM_ROLES.includes(role as PlatformRole)
    ? (role as PlatformRole)
    : null;
}

export function normalizePlatformRoles(
  role: PlatformRoleInput,
): PlatformRole[] {
  const values = Array.isArray(role) ? role : role ? [role] : [];
  return Array.from(
    new Set(
      values.flatMap((value) => {
        const normalized = normalizePlatformRole(value);
        return normalized ? [normalized] : [];
      }),
    ),
  );
}

export function isClientRole(role: PlatformRoleInput): boolean {
  return normalizePlatformRoles(role).some((normalized) =>
    CLIENT_ROLES.has(normalized),
  );
}

export function isPartnerRole(role: PlatformRoleInput): boolean {
  return normalizePlatformRoles(role).some((normalized) =>
    PARTNER_ROLES.has(normalized),
  );
}

export function isInternalRole(role: PlatformRoleInput): boolean {
  return normalizePlatformRoles(role).some((normalized) =>
    INTERNAL_ROLES.has(normalized),
  );
}

export function platformHomeForRole(
  role: PlatformRoleInput,
  flags: PlatformFeatureFlags = platformFeatureFlags(),
  effectivePermissions?: readonly string[],
): string {
  const permits = (permission: string): boolean =>
    effectivePermissions === undefined ||
    effectivePermissions.includes(permission);
  if (isClientRole(role) && permits("project:read"))
    return flags.clientPortal ? "/portal" : "/projects";
  if (isPartnerRole(role)) {
    if (permits("partner_relationship:read")) return "/partner";
    if (permits("project:read")) return "/projects";
  }
  const roles = normalizePlatformRoles(role);
  if (
    roles.includes("platform_admin_restricted") ||
    roles.includes("restricted_platform_administrator")
  ) {
    return "/app/security";
  }
  if (roles.includes("read_only_auditor") || roles.includes("client_auditor")) {
    return "/evidence-readiness";
  }
  return "/app";
}

export function getPlatformAccessDecision(
  role: PlatformRoleInput,
  area: PlatformArea,
  flags: PlatformFeatureFlags = platformFeatureFlags(),
  effectivePermissions?: readonly string[],
): PlatformAccessDecision {
  const normalized = normalizePlatformRoles(role);
  const allowed = normalized.some((assignedRole) =>
    AREA_ROLES[area].has(assignedRole),
  );
  if (!allowed) {
    return {
      area,
      allowed: false,
      enabled: false,
      state: "denied",
      reason: "Your assigned role does not include this workspace.",
    };
  }

  const requiredPermission = AREA_REQUIRED_PERMISSION[area];
  if (
    requiredPermission &&
    effectivePermissions !== undefined &&
    !effectivePermissions.includes(requiredPermission)
  ) {
    return {
      area,
      allowed: false,
      enabled: false,
      state: "denied",
      reason:
        "The selected organisation context does not grant this permission.",
    };
  }

  const feature = AREA_FEATURE[area];
  const featureEnabled = feature ? flags[feature] : true;
  if (!featureEnabled) {
    return {
      area,
      allowed: true,
      enabled: false,
      state: "pending_activation",
      reason:
        "This capability is technically present but has not been commercially activated.",
    };
  }

  return {
    area,
    allowed: true,
    enabled: true,
    state: "active",
    reason: "This workspace is enabled for your assigned role.",
  };
}

export function navigationForRole(
  role: PlatformRoleInput,
  flags: PlatformFeatureFlags = platformFeatureFlags(),
  effectivePermissions?: readonly string[],
): Array<PlatformNavItem & { state: PlatformAccessDecision["state"] }> {
  return NAV_ITEMS.flatMap((item) => {
    const decision = getPlatformAccessDecision(
      role,
      item.area,
      flags,
      effectivePermissions,
    );
    const singlePermissionAllowed =
      !item.requiredPermission ||
      effectivePermissions === undefined ||
      effectivePermissions.includes(item.requiredPermission);
    const permissionSetAllowed =
      !item.requiredPermissions ||
      effectivePermissions === undefined ||
      item.requiredPermissions.every((permission) =>
        effectivePermissions.includes(permission),
      );
    return decision.allowed && singlePermissionAllowed && permissionSetAllowed
      ? [{ ...item, state: decision.state }]
      : [];
  });
}
