import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { UserButton } from "@clerk/clerk-react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import {
  Bell,
  BookOpenCheck,
  Briefcase,
  Building2,
  CheckCircle,
  CreditCard,
  FileCheck2,
  LayoutDashboard,
  Library,
  LockKeyhole,
  Menu,
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

const ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/clients": Users,
  "/projects": Briefcase,
  "/sbd": Library,
  "/portal": Building2,
  "/partner": ShieldCheck,
  "/operations": BookOpenCheck,
  "/evidence-readiness": FileCheck2,
  "/billing": CreditCard,
  "/notifications": Bell,
  "/security": LockKeyhole,
  "/settings": Settings,
};

const NAV_GROUPS: PlatformNavItem["group"][] = [
  "Workspace",
  "Review",
  "Commercial",
  "Administration",
];

function roleLabel(role: string): string {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
    <nav aria-label="Primary navigation" className="space-y-5">
      {NAV_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (groupItems.length === 0) return null;
        return (
          <div key={group}>
            <p className="mb-1 px-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {group}
            </p>
            <ul className="space-y-1">
              {groupItems.map((item) => {
                const Icon = ICONS[item.href] ?? CheckCircle;
                const active =
                  location === item.href ||
                  (item.href !== "/" && location.startsWith(item.href + "/"));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon aria-hidden="true" className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                      {item.state === "pending_activation" ? (
                        <span
                          className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-900"
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

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

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
            description="This account cannot access any organisation or tender workspace. An authorised administrator must review the account status."
          />
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </div>
    );
  }

  if (organisationAccess?.isError) {
    return <OrganisationLoadError />;
  }

  if (organisationAccess?.needsSelection) {
    return <OrganisationSelectionGate />;
  }

  const effectiveRoles = organisationAccess?.activeOrganisation
    ? organisationAccess.effectiveRoles
    : [String(user.role)];
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
            description="Your identity is registered, but no platform role has been assigned. Protected organisation and tender data remain unavailable."
          />
          <UserButton afterSignOutUrl="/sign-in" />
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

  const navItems = navigationForRole(normalizedRoles, platformFeatureFlags());
  const assignedRoleLabel = normalizedRoles.map(roleLabel).join(" / ");

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-background px-4 py-2 text-sm font-medium shadow focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      {!online ? <OfflineBanner /> : null}

      <div className="flex min-h-screen">
        <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-card md:flex">
          <div className="flex items-center gap-3 border-b border-border p-5">
            <div
              className="flex size-9 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
              aria-hidden="true"
            >
              V
            </div>
            <div>
              <p className="font-serif font-semibold tracking-tight">
                Valo Platform
              </p>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Evidence-led tender controls
              </p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <AppNavigation items={navItems} location={location} />
          </div>
          <div className="border-t border-border p-4">
            <div className="flex items-center gap-3 rounded-md bg-muted/50 p-3">
              <UserButton afterSignOutUrl="/sign-in" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {user.name || user.email}
                </p>
                <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                  {assignedRoleLabel}
                </p>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90">
            <div className="flex min-h-16 items-center justify-between gap-3 px-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  className="inline-flex size-10 items-center justify-center rounded-md border border-border md:hidden"
                  aria-expanded={mobileOpen}
                  aria-controls="mobile-primary-navigation"
                  aria-label={
                    mobileOpen
                      ? "Close navigation menu"
                      : "Open navigation menu"
                  }
                  onClick={() => setMobileOpen((open) => !open)}
                >
                  {mobileOpen ? (
                    <X aria-hidden="true" className="size-5" />
                  ) : (
                    <Menu aria-hidden="true" className="size-5" />
                  )}
                </button>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold md:hidden">
                    Valo Platform
                  </p>
                  <p className="hidden truncate text-sm font-medium md:block">
                    {assignedRoleLabel}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {organisationAccess?.activeOrganisation?.name ??
                      "Server-authorised workspace"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <OrganisationSwitcher />
                <StateBadge
                  state={online ? "active" : "offline"}
                  label={online ? "Connected" : "Offline"}
                  className="hidden sm:inline-flex"
                />
                <div className="md:hidden">
                  <UserButton afterSignOutUrl="/sign-in" />
                </div>
              </div>
            </div>
            {mobileOpen ? (
              <div
                id="mobile-primary-navigation"
                className="max-h-[70dvh] overflow-y-auto border-t border-border bg-card p-4 md:hidden"
              >
                <AppNavigation
                  items={navItems}
                  location={location}
                  onNavigate={() => setMobileOpen(false)}
                />
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
