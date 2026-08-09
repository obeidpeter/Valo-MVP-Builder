import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { UserButton } from "@clerk/clerk-react";
import { getGetMeQueryKey, useGetMe } from "@workspace/api-client-react";
import {
  Bell,
  BookOpenCheck,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  CreditCard,
  FileStack,
  LayoutDashboard,
  Library,
  LockKeyhole,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  navigationForRole,
  normalizePlatformRoles,
  platformFeatureFlags,
  type PlatformNavItem,
} from "@/lib/platform-access";
import {
  LoadingPanel,
  OfflineBanner,
  StateBadge,
  StatusPanel,
} from "@/components/platform-states";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import {
  OrganisationLoadError,
  OrganisationSelectionGate,
  OrganisationSwitcher,
} from "@/components/organisation-switcher";
import { ValoMark } from "@/components/valo-mark";
import { GlobalCommand } from "@/components/global-command";

const ICONS: Record<string, LucideIcon> = {
  "/app": LayoutDashboard,
  "/clients": Users,
  "/projects": BriefcaseBusiness,
  "/sbd": BookOpenCheck,
  "/portal": Building2,
  "/partner": ShieldCheck,
  "/operations": ClipboardCheck,
  "/evidence-readiness": Library,
  "/reports": FileStack,
  "/billing": CreditCard,
  "/notifications": Bell,
  "/app/security": LockKeyhole,
  "/organisation-settings": Settings,
  "/settings": ScrollText,
};

const NAV_GROUPS: PlatformNavItem["group"][] = [
  "Workspace",
  "Delivery",
  "Oversight",
  "Administration",
];

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  reviewer: "Reviewer",
  analyst: "Analyst",
  client_owner: "Client owner",
  client_admin: "Client administrator",
  client_organisation_owner: "Client owner",
  client_administrator: "Client administrator",
  bid_manager: "Bid lead",
  contributor: "Contributor",
  client_reviewer: "Client reviewer",
  client_reviewer_approver: "Reviewer and approver",
  client_auditor: "Client auditor",
  read_only_auditor: "Read-only auditor",
  valo_analyst: "Valo analyst",
  valo_quality_adviser: "Valo quality adviser",
  valo_operations_admin: "Valo operations administrator",
  valo_operations_administrator: "Valo operations administrator",
  platform_admin_restricted: "Restricted platform administrator",
  restricted_platform_administrator: "Restricted platform administrator",
  partner_admin: "Partner administrator",
  consultancy_partner_administrator: "Partner administrator",
  partner_analyst: "Partner analyst",
  partner_reviewer: "Partner reviewer",
  consultancy_partner_analyst_reviewer: "Partner analyst and reviewer",
};

function roleLabel(role: string): string {
  return (
    ROLE_LABELS[role] ??
    role
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function AppNavigation({
  items,
  location,
  onNavigate,
}: {
  items: ReturnType<typeof navigationForRole>;
  location: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Primary navigation" className="space-y-6">
      {NAV_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (groupItems.length === 0) return null;
        return (
          <div key={group}>
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.13em] text-sidebar-foreground/65">
              {group}
            </p>
            <ul className="space-y-1">
              {groupItems.map((item) => {
                const Icon = ICONS[item.href] ?? CheckCircle2;
                const active =
                  location === item.href ||
                  (item.href !== "/app" &&
                    location.startsWith(item.href + "/"));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-primary"
                          : "text-sidebar-foreground/72 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                      )}
                    >
                      <Icon
                        aria-hidden="true"
                        className="size-[1.1rem] shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                      {item.state === "pending_activation" ? (
                        <span
                          className="rounded-full border border-amber-300/35 bg-amber-300/10 px-2 py-0.5 text-xs font-semibold text-amber-200"
                          title="Commercial activation pending"
                        >
                          Pending
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function UtilityLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon aria-hidden="true" className="size-[1.1rem]" />
    </Link>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const online = useOnlineStatus();
  const organisationAccess = useOrganisationAccess();
  const {
    data: user,
    isLoading,
    error,
  } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: (failureCount, err) => {
        const status = (err as { status?: number } | null)?.status;
        if (status === 403) return false;
        return failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(400 * 2 ** attempt, 2000),
    },
  });

  useEffect(() => setMobileOpen(false), [location]);

  if (isLoading || organisationAccess?.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="w-full max-w-lg">
          <LoadingPanel label="Authenticating and loading your assigned workspace" />
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="w-full max-w-lg">
          <StatusPanel
            state={online ? "error" : "offline"}
            title={
              online
                ? "Authentication failed"
                : "Identity service unavailable while offline"
            }
            description="The application could not verify the current session. Protected records and actions remain unavailable."
          />
        </div>
      </div>
    );
  }

  if (user.status === "disabled") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="w-full max-w-lg space-y-6 text-center">
          <StatusPanel
            state="blocked"
            title="Account disabled"
            description="This account cannot access any organisation or pursuit workspace. An authorised administrator must review the account status."
          />
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>
    );
  }

  if (!organisationAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="w-full max-w-lg">
          <StatusPanel
            state="error"
            title="Organisation access could not be verified"
            description="The trusted organisation access context is unavailable. No tenant workspace or action has been opened."
          />
        </div>
      </div>
    );
  }
  if (organisationAccess.isError) return <OrganisationLoadError />;
  if (organisationAccess.needsSelection) return <OrganisationSelectionGate />;
  if (!organisationAccess.activeOrganisation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="w-full max-w-lg space-y-6 text-center">
          <StatusPanel
            state="pending"
            title="Pending organisation access"
            description="No active organisation membership is available for this identity and session. Protected organisation and pursuit data remain unavailable."
          />
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>
    );
  }

  const effectiveRoles = organisationAccess.effectiveRoles;
  const pendingRole =
    effectiveRoles.length === 0 ||
    effectiveRoles.every((role) => role === "none");

  if (pendingRole) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="w-full max-w-lg space-y-6 text-center">
          <StatusPanel
            state="pending"
            title="Pending access"
            description="Your identity is registered, but no organisation role has been assigned. Protected organisation and pursuit data remain unavailable."
          />
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>
    );
  }

  const normalizedRoles = normalizePlatformRoles(effectiveRoles);
  if (normalizedRoles.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="w-full max-w-lg">
          <StatusPanel
            state="blocked"
            title="Role configuration unsupported"
            description="The server returned a role that this application version does not recognise. No workspace has been opened."
          />
        </div>
      </div>
    );
  }

  const navItems = navigationForRole(
    normalizedRoles,
    platformFeatureFlags(),
    organisationAccess.effectivePermissions,
  );
  const assignedRoleLabel = normalizedRoles.map(roleLabel).join(" · ");
  const navIncludes = (href: string) =>
    navItems.some((item) => item.href === href);

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-card px-4 py-2 text-sm font-medium shadow-sm focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      {!online ? <OfflineBanner /> : null}

      <div className="flex min-h-screen">
        <aside className="hidden w-[17rem] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
          <div className="border-b border-sidebar-border p-5">
            <Link
              href="/app"
              aria-label="Valo Command Centre"
              className="block w-fit rounded-md text-sidebar-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <ValoMark />
            </Link>
            <p className="mt-3 text-xs leading-5 text-sidebar-foreground/55">
              Evidence-led tender controls
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <AppNavigation items={navItems} location={location} />
          </div>
          <div className="border-t border-sidebar-border p-4">
            <div className="flex items-center gap-3 rounded-lg bg-sidebar-accent/70 p-3">
              <UserButton
                afterSignOutUrl="/"
                userProfileMode="navigation"
                userProfileUrl="/account"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {user.name || user.email}
                </p>
                <p className="mt-0.5 truncate text-xs text-sidebar-foreground/55">
                  {assignedRoleLabel}
                </p>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-border bg-background">
            <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6">
              <button
                type="button"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-card lg:hidden"
                aria-expanded={mobileOpen}
                aria-controls="mobile-primary-navigation"
                aria-label={
                  mobileOpen ? "Close navigation menu" : "Open navigation menu"
                }
                onClick={() => setMobileOpen((open) => !open)}
              >
                {mobileOpen ? (
                  <X aria-hidden="true" className="size-5" />
                ) : (
                  <Menu aria-hidden="true" className="size-5" />
                )}
              </button>
              <div className="min-w-0 shrink sm:max-w-60">
                <p className="truncate text-sm font-semibold">
                  {organisationAccess.activeOrganisation.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {assignedRoleLabel}
                </p>
              </div>
              <div className="hidden min-w-0 flex-1 justify-center sm:flex">
                <GlobalCommand navigation={navItems} />
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-0.5">
                {navIncludes("/operations") ? (
                  <UtilityLink
                    href="/operations"
                    label="Tasks and reviews"
                    icon={ClipboardCheck}
                  />
                ) : null}
                {navIncludes("/notifications") ? (
                  <UtilityLink
                    href="/notifications"
                    label="Notifications"
                    icon={Bell}
                  />
                ) : null}
                <UtilityLink
                  href="/how-it-works"
                  label="Help and workflow guide"
                  icon={CircleHelp}
                />
                <div className="hidden px-2 xl:block">
                  <OrganisationSwitcher />
                </div>
                <StateBadge
                  state={online ? "active" : "offline"}
                  label={online ? "Connected" : "Offline"}
                  className="hidden 2xl:inline-flex"
                />
                <div className="ml-1 lg:hidden">
                  <UserButton
                    afterSignOutUrl="/"
                    userProfileMode="navigation"
                    userProfileUrl="/account"
                  />
                </div>
              </div>
            </div>
            <div className="px-4 pb-3 sm:hidden">
              <GlobalCommand navigation={navItems} />
            </div>
            {mobileOpen ? (
              <div
                id="mobile-primary-navigation"
                className="max-h-[75dvh] overflow-y-auto border-t border-sidebar-border bg-sidebar p-4 text-sidebar-foreground lg:hidden"
              >
                <AppNavigation
                  items={navItems}
                  location={location}
                  onNavigate={() => setMobileOpen(false)}
                />
                <div className="mt-6 border-t border-sidebar-border pt-4 xl:hidden">
                  <OrganisationSwitcher />
                </div>
              </div>
            ) : null}
          </header>

          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
