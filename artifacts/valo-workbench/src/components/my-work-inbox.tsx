import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { assertAuthorityScopeCurrent } from "@/lib/authority-scope";
import {
  adaptWorkInbox,
  type WorkInboxGroup,
  type WorkInboxItem,
} from "@/lib/work-inbox";
import { LoadingPanel, StateBadge, StatusPanel } from "./platform-states";

const GROUP_LABELS: Record<WorkInboxGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  unscheduled: "Unscheduled",
};

function itemKind(kind: WorkInboxItem["kind"]): string {
  return kind.replaceAll("_", " ");
}

function dueLabel(value: string | null): string {
  if (!value) return "No due date recorded";
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(value));
}

export function MyWorkInbox() {
  const access = useOrganisationAccess();
  const online = useOnlineStatus();
  const meQuery = useGetMe();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const actorUserId = meQuery.data?.id ?? "";
  const membershipId = access?.activeOrganisation?.membershipId ?? "";
  const directMembership =
    access?.activeOrganisation?.accessSource === "membership" &&
    access.activeOrganisation.membershipOrganisationId === organisationId;
  const capabilityKey = [...(access?.effectivePermissions ?? [])]
    .filter((permission) =>
      [
        "project:read",
        "project:update",
        "billing:read",
        "entitlement:read",
        "order:create",
      ].includes(permission),
    )
    .sort()
    .join("|");
  const enabled = Boolean(
    online && directMembership && organisationId && membershipId && actorUserId,
  );
  const activeScope = useRef({
    organisationId,
    membershipId,
    actorUserId,
    capabilityKey,
  });
  activeScope.current = {
    organisationId,
    membershipId,
    actorUserId,
    capabilityKey,
  };
  const query = useQuery({
    queryKey: [
      "work-inbox",
      organisationId,
      membershipId,
      actorUserId,
      capabilityKey,
    ],
    enabled,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const requestedScope = {
        organisationId,
        membershipId,
        actorUserId,
        capabilityKey,
      };
      const payload = await customFetch<unknown>("/api/work-inbox?limit=50", {
        responseType: "json",
        cache: "no-store",
      });
      assertAuthorityScopeCurrent(
        activeScope.current,
        requestedScope,
        "Work-inbox authority changed while tasks loaded",
      );
      return adaptWorkInbox(payload, organisationId);
    },
  });

  if (!directMembership) return null;
  return (
    <section aria-labelledby="my-work-inbox-heading" className="space-y-4">
      <div>
        <h2 id="my-work-inbox-heading" className="text-xl font-semibold">
          My Work
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          Your owned work and work you are currently authorised to assign,
          grouped by West Africa Time. This private view never changes a task.
        </p>
      </div>
      {!online ? (
        <StatusPanel
          state="offline"
          title="My Work is unavailable offline"
          description="No cached assignment state is shown. Reconnect to revalidate current tenant authority."
        />
      ) : query.isLoading || meQuery.isLoading ? (
        <LoadingPanel label="Loading current work assignments" />
      ) : query.isError || !query.data ? (
        <StatusPanel
          state="error"
          title="My Work could not be verified"
          description="The inbox failed closed. Reload after current membership and task authority can be checked."
        />
      ) : Object.values(query.data.groups).every(
          (items) => items.length === 0,
        ) ? (
        <StatusPanel
          state="empty"
          title="No authorised active work returned"
          description="There are no owned or assignable unassigned tasks in the bounded authoritative inbox."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {(Object.keys(GROUP_LABELS) as WorkInboxGroup[]).map((group) => {
            const items = query.data.groups[group];
            if (items.length === 0) return null;
            return (
              <div
                key={group}
                className="overflow-hidden rounded-lg border bg-card"
              >
                <div className="border-b px-4 py-3">
                  <h3 className="font-semibold">{GROUP_LABELS[group]}</h3>
                </div>
                <div className="divide-y">
                  {items.map((item) => (
                    <Link
                      key={item.key}
                      href={item.href}
                      className="flex min-h-24 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {item.projectTitle} · {itemKind(item.kind)} ·{" "}
                          {dueLabel(item.dueAt)} WAT
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.assignment === "owned"
                            ? "Assigned to you"
                            : "Unassigned · you can assign or update this work"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StateBadge
                          state={group === "overdue" ? "blocked" : "pending"}
                          label={item.status.replaceAll("_", " ")}
                        />
                        <ArrowRight aria-hidden="true" className="size-4" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {query.data?.truncated ? (
        <p className="text-xs text-muted-foreground">
          The bounded inbox shows the first {query.data.limit} authorised tasks
          across all groups. Open the linked workspaces for the remainder.
        </p>
      ) : null}
    </section>
  );
}
