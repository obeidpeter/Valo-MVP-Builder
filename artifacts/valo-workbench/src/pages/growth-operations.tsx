import { useEffect, useRef, useState } from "react";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GrowthLeadContactHandoffResponse,
  GrowthLeadsResponse,
  GrowthOffersResponse,
  GrowthOnboardingMutationResponse,
  GrowthOnboardingResponse,
  LeadContactHandoff,
  LeadContactHandoffPurpose,
  LeadInboxAction,
  LeadInboxItem,
  OfferCatalogueItem,
  OnboardingJourney,
  OnboardingProgress,
} from "@/components/growth-suite/growth-suite-contract";
import { GrowthOnboardingJourney } from "@/components/growth-suite/onboarding-journey";
import { LeadOperationsInbox } from "@/components/growth-suite/lead-operations-inbox";
import { GrowthOfferCatalogue } from "@/components/growth-suite/offer-catalogue";
import { PageHeader, StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useToast } from "@/hooks/use-toast";

const QUERY_ROOT = "growth-suite";
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

async function getGrowthOnboarding(): Promise<GrowthOnboardingResponse> {
  return customFetch("/api/growth-suite/onboarding", {
    responseType: "json",
  });
}

async function getGrowthOffers(): Promise<GrowthOffersResponse> {
  return customFetch("/api/growth-suite/offers", { responseType: "json" });
}

async function getGrowthLeads(): Promise<GrowthLeadsResponse> {
  return customFetch("/api/growth-suite/leads?limit=25", {
    responseType: "json",
    cache: "no-store",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}

function boundedText(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= maximum
    ? value
    : null;
}

export function adaptLeadContactHandoffResponse(
  value: unknown,
  expected: { leadId: string; purpose: LeadContactHandoffPurpose },
): GrowthLeadContactHandoffResponse {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["handoff", "contactDataIncluded", "authorityNote"]) ||
    value.contactDataIncluded !== true ||
    !boundedText(value.authorityNote, 2_048) ||
    !isRecord(value.handoff) ||
    !exactKeys(value.handoff, [
      "leadId",
      "contactName",
      "preferredContactMethod",
      "contactValue",
      "purpose",
      "accessedAt",
      "version",
    ])
  ) {
    throw new Error("Invalid lead contact handoff response");
  }
  const handoff = value.handoff;
  const leadId = boundedText(handoff.leadId, 128);
  const contactName = boundedText(handoff.contactName, 160);
  const contactValue = boundedText(handoff.contactValue, 512);
  const accessedAt = boundedText(handoff.accessedAt, 64);
  const version = handoff.version;
  if (
    !leadId ||
    !ID_PATTERN.test(leadId) ||
    leadId !== expected.leadId ||
    !contactName ||
    !contactValue ||
    !["email", "telephone"].includes(
      handoff.preferredContactMethod as string,
    ) ||
    handoff.purpose !== expected.purpose ||
    !accessedAt ||
    Number.isNaN(Date.parse(accessedAt)) ||
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    throw new Error("Invalid lead contact handoff response");
  }
  return {
    handoff: {
      leadId,
      contactName,
      preferredContactMethod: handoff.preferredContactMethod as
        | "email"
        | "telephone",
      contactValue,
      purpose: expected.purpose,
      accessedAt,
      version,
    },
    contactDataIncluded: true,
    authorityNote: value.authorityNote as string,
  };
}

export function GrowthOperationsView({
  onboarding,
  onboardingProgress,
  catalogueVersion,
  offers,
  leads = [],
  currentUserId,
  scopeKey,
  leadContactHandoff,
  handoffPendingLeadId,
  canOperateLeads = false,
  mutationPending = false,
  onLeadAction,
  onRequestContactHandoff,
  onDismissContactHandoff,
  onOnboardingToggle,
}: {
  onboarding: OnboardingJourney;
  onboardingProgress: OnboardingProgress;
  catalogueVersion: string;
  offers: readonly OfferCatalogueItem[];
  leads?: readonly LeadInboxItem[];
  currentUserId?: string;
  scopeKey?: string;
  leadContactHandoff?: LeadContactHandoff | null;
  handoffPendingLeadId?: string | null;
  canOperateLeads?: boolean;
  mutationPending?: boolean;
  onLeadAction?: (leadId: string, action: LeadInboxAction) => void;
  onRequestContactHandoff?: (
    leadId: string,
    expectedVersion: number,
    purpose: LeadContactHandoffPurpose,
  ) => void;
  onDismissContactHandoff?: () => void;
  onOnboardingToggle?: (itemId: string, completed: boolean) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-10 p-5 sm:p-8">
      <PageHeader
        eyebrow="Growth operations"
        title="Turn interest into governed work"
        description="A bounded operating surface for lead qualification, first-pursuit onboarding and a versioned offer catalogue. It contains no CRM, automatic messaging, pricing, payment or pursuit-creation authority, and its durable quote ledger is unavailable."
        state="active"
      />
      {canOperateLeads ? (
        <LeadOperationsInbox
          key={scopeKey}
          items={leads}
          currentUserId={currentUserId}
          handoff={leadContactHandoff}
          handoffPendingLeadId={handoffPendingLeadId}
          mutationPending={mutationPending}
          onAction={onLeadAction}
          onRequestContactHandoff={onRequestContactHandoff}
          onDismissContactHandoff={onDismissContactHandoff}
        />
      ) : null}
      <GrowthOnboardingJourney
        journey={onboarding}
        progress={onboardingProgress}
        mutationPending={mutationPending}
        onToggle={onOnboardingToggle}
      />
      <GrowthOfferCatalogue
        catalogueVersion={catalogueVersion}
        offers={offers}
      />
    </div>
  );
}

export default function GrowthOperationsPage() {
  const access = useOrganisationAccess();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const meQuery = useGetMe();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const roles = access?.effectiveRoles ?? [];
  const permissions = access?.effectivePermissions ?? [];
  const directMembership =
    access?.activeOrganisation?.accessSource === "membership";
  const canView = Boolean(
    organisationId &&
    directMembership &&
    permissions.includes("organisation:read"),
  );
  const canOperateLeads = Boolean(
    canView &&
    permissions.includes("client:update") &&
    roles.some((role) =>
      ["valo_operations_administrator", "valo_analyst"].includes(role),
    ),
  );
  const queryPrefix = [QUERY_ROOT, organisationId] as const;
  const onboardingQuery = useQuery({
    queryKey: [...queryPrefix, "onboarding"],
    queryFn: getGrowthOnboarding,
    enabled: canView,
  });
  const offersQuery = useQuery({
    queryKey: [...queryPrefix, "offers"],
    queryFn: getGrowthOffers,
    enabled: canView,
  });
  const leadsQuery = useQuery({
    queryKey: [...queryPrefix, "leads"],
    queryFn: getGrowthLeads,
    enabled: canOperateLeads,
  });
  const [leadContactHandoff, setLeadContactHandoff] =
    useState<LeadContactHandoff | null>(null);
  const [handoffPendingLeadId, setHandoffPendingLeadId] = useState<
    string | null
  >(null);
  const handoffAbortRef = useRef<AbortController | null>(null);
  const activeOrganisationIdRef = useRef(organisationId);
  activeOrganisationIdRef.current = organisationId;

  const clearContactHandoff = () => {
    handoffAbortRef.current?.abort();
    handoffAbortRef.current = null;
    setLeadContactHandoff(null);
    setHandoffPendingLeadId(null);
  };

  useEffect(() => {
    clearContactHandoff();
    return () => handoffAbortRef.current?.abort();
  }, [organisationId]);

  useEffect(() => {
    if (!leadContactHandoff) return;
    const current = leadsQuery.data?.items.find(
      ({ id }) => id === leadContactHandoff.leadId,
    );
    if (
      !current ||
      current.assignedToUserId !== meQuery.data?.id ||
      current.version > leadContactHandoff.version
    ) {
      setLeadContactHandoff(null);
    }
  }, [leadContactHandoff, leadsQuery.data?.items, meQuery.data?.id]);

  const invalidateLeads = () =>
    queryClient.invalidateQueries({ queryKey: [...queryPrefix, "leads"] });
  const mutationError = (title: string) => () =>
    toast({
      variant: "destructive",
      title,
      description:
        "Refresh this tenant-scoped queue before trying again. No external action was taken.",
    });
  const onboardingMutation = useMutation({
    mutationFn: ({
      itemId,
      completed,
    }: {
      itemId: string;
      completed: boolean;
    }): Promise<GrowthOnboardingMutationResponse> =>
      customFetch("/api/growth-suite/onboarding/progress", {
        method: "POST",
        body: JSON.stringify({
          journeyVersion: onboardingQuery.data?.journey.policyVersion,
          itemId,
          expectedVersion: onboardingQuery.data?.progress.version,
          completed,
        }),
        responseType: "json",
      }),
    onSuccess: (response) => {
      queryClient.setQueryData<GrowthOnboardingResponse>(
        [...queryPrefix, "onboarding"],
        (current) =>
          current ? { ...current, progress: response.progress } : current,
      );
      toast({ title: "Onboarding checkpoint recorded" });
    },
    onError: () => {
      mutationError("Onboarding checkpoint could not be recorded")();
      void queryClient.invalidateQueries({
        queryKey: [...queryPrefix, "onboarding"],
      });
    },
  });
  const leadMutation = useMutation({
    mutationFn: ({
      leadId,
      action,
    }: {
      leadId: string;
      action: LeadInboxAction;
    }) =>
      customFetch(
        `/api/growth-suite/leads/${encodeURIComponent(leadId)}/actions`,
        {
          method: "POST",
          body: JSON.stringify(action),
          responseType: "json",
          cache: "no-store",
        },
      ),
    onMutate: clearContactHandoff,
    onSuccess: () => {
      toast({ title: "Lead operation recorded" });
      void invalidateLeads();
    },
    onError: mutationError("Lead operation could not be recorded"),
  });

  const requestContactHandoff = async (
    leadId: string,
    expectedVersion: number,
    purpose: LeadContactHandoffPurpose,
  ) => {
    const current = leadsQuery.data?.items.find(({ id }) => id === leadId);
    if (
      !current ||
      current.version !== expectedVersion ||
      current.assignedToUserId !== meQuery.data?.id
    ) {
      mutationError("Assigned contact could not be opened")();
      void invalidateLeads();
      return;
    }
    clearContactHandoff();
    const requestOrganisationId = organisationId;
    const releaseCriticalWorkflow = access?.beginCriticalWorkflow();
    const controller = new AbortController();
    handoffAbortRef.current = controller;
    setHandoffPendingLeadId(leadId);
    try {
      const payload = await customFetch<unknown>(
        `/api/growth-suite/leads/${encodeURIComponent(leadId)}/contact-handoff`,
        {
          method: "POST",
          body: JSON.stringify({ expectedVersion, purpose }),
          responseType: "json",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (
        controller.signal.aborted ||
        activeOrganisationIdRef.current !== requestOrganisationId
      ) {
        return;
      }
      const response = adaptLeadContactHandoffResponse(payload, {
        leadId,
        purpose,
      });
      if (
        controller.signal.aborted ||
        activeOrganisationIdRef.current !== requestOrganisationId
      ) {
        return;
      }
      setLeadContactHandoff(response.handoff);
      toast({ title: "Assigned contact opened for the recorded purpose" });
      void invalidateLeads();
    } catch {
      if (controller.signal.aborted) return;
      mutationError("Assigned contact could not be opened")();
      void invalidateLeads();
    } finally {
      releaseCriticalWorkflow?.();
      if (handoffAbortRef.current === controller) {
        handoffAbortRef.current = null;
        setHandoffPendingLeadId(null);
      }
    }
  };

  if (!canView) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="blocked"
          title="Direct organisation membership required"
          description="Growth onboarding and catalogue access are not available through partner-derived or emergency access."
        />
      </div>
    );
  }
  if (onboardingQuery.isLoading || offersQuery.isLoading) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="pending"
          title="Loading growth operations"
          description="Resolving your role-derived onboarding and the active offer catalogue."
        />
      </div>
    );
  }
  if (
    onboardingQuery.isError ||
    offersQuery.isError ||
    !onboardingQuery.data ||
    !offersQuery.data
  ) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="error"
          title="Growth operations could not be loaded"
          description="No empty onboarding state or catalogue should be inferred. Refresh after the route and durable onboarding repository are available."
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void onboardingQuery.refetch();
              void offersQuery.refetch();
            }}
          >
            Retry
          </Button>
        </StatusPanel>
      </div>
    );
  }

  return (
    <>
      {canOperateLeads && leadsQuery.isError ? (
        <div className="mx-auto w-full max-w-7xl px-5 pt-5 sm:px-8 sm:pt-8">
          <StatusPanel
            state="partial"
            title="Lead operations queue is unavailable"
            description="Onboarding and the versioned catalogue remain available. Do not interpret unavailable lead data as an empty queue."
          />
        </div>
      ) : null}
      <GrowthOperationsView
        onboarding={onboardingQuery.data.journey}
        onboardingProgress={onboardingQuery.data.progress}
        catalogueVersion={offersQuery.data.catalogueVersion}
        offers={offersQuery.data.items}
        leads={leadsQuery.data?.items}
        currentUserId={meQuery.data?.id}
        scopeKey={organisationId}
        leadContactHandoff={leadContactHandoff}
        handoffPendingLeadId={handoffPendingLeadId}
        canOperateLeads={canOperateLeads && !leadsQuery.isError}
        mutationPending={
          leadMutation.isPending ||
          onboardingMutation.isPending ||
          handoffPendingLeadId !== null
        }
        onLeadAction={(leadId, action) =>
          leadMutation.mutate({ leadId, action })
        }
        onRequestContactHandoff={(leadId, expectedVersion, purpose) => {
          void requestContactHandoff(leadId, expectedVersion, purpose);
        }}
        onDismissContactHandoff={clearContactHandoff}
        onOnboardingToggle={(itemId, completed) =>
          onboardingMutation.mutate({ itemId, completed })
        }
      />
    </>
  );
}
