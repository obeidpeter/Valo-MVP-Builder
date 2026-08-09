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
  | "operations"
  | "client_portal"
  | "partner_workspace"
  | "evidence_readiness"
  | "billing_entitlements"
  | "notifications"
  | "security_audit"
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
  group: "Workspace" | "Review" | "Commercial" | "Administration";
  feature?: CommercialFeature;
}

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
  settings: SETTINGS_ROLES,
};

const AREA_FEATURE: Partial<Record<PlatformArea, CommercialFeature>> = {
  client_portal: "clientPortal",
  partner_workspace: "partnerWorkspace",
  billing_entitlements: "billingEntitlements",
  notifications: "notificationAdapters",
};

const NAV_ITEMS: PlatformNavItem[] = [
  { href: "/", label: "Dashboard", area: "workbench", group: "Workspace" },
  { href: "/clients", label: "Clients", area: "workbench", group: "Workspace" },
  {
    href: "/projects",
    label: "Projects",
    area: "workbench",
    group: "Workspace",
  },
  { href: "/sbd", label: "SBD Corpus", area: "workbench", group: "Workspace" },
  {
    href: "/portal",
    label: "Client portal",
    area: "client_portal",
    group: "Workspace",
    feature: "clientPortal",
  },
  {
    href: "/partner",
    label: "Partner workspace",
    area: "partner_workspace",
    group: "Workspace",
    feature: "partnerWorkspace",
  },
  {
    href: "/operations",
    label: "Operations queues",
    area: "operations",
    group: "Review",
  },
  {
    href: "/evidence-readiness",
    label: "Evidence & readiness",
    area: "evidence_readiness",
    group: "Review",
  },
  {
    href: "/billing",
    label: "Billing & entitlements",
    area: "billing_entitlements",
    group: "Commercial",
    feature: "billingEntitlements",
  },
  {
    href: "/notifications",
    label: "Notifications",
    area: "notifications",
    group: "Commercial",
    feature: "notificationAdapters",
  },
  {
    href: "/security",
    label: "Security & audit",
    area: "security_audit",
    group: "Administration",
  },
  {
    href: "/settings",
    label: "Settings",
    area: "settings",
    group: "Administration",
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

export function platformHomeForRole(role: PlatformRoleInput): string {
  if (isClientRole(role)) return "/portal";
  if (isPartnerRole(role)) return "/partner";
  const roles = normalizePlatformRoles(role);
  if (
    roles.includes("platform_admin_restricted") ||
    roles.includes("restricted_platform_administrator")
  ) {
    return "/security";
  }
  if (roles.includes("read_only_auditor") || roles.includes("client_auditor")) {
    return "/evidence-readiness";
  }
  return "/";
}

export function getPlatformAccessDecision(
  role: PlatformRoleInput,
  area: PlatformArea,
  flags: PlatformFeatureFlags = platformFeatureFlags(),
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
): Array<PlatformNavItem & { state: PlatformAccessDecision["state"] }> {
  return NAV_ITEMS.flatMap((item) => {
    const decision = getPlatformAccessDecision(role, item.area, flags);
    return decision.allowed ? [{ ...item, state: decision.state }] : [];
  });
}
