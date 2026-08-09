import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  customFetch,
  getGetMeQueryKey,
  setRequestContextGetter,
  useGetMe,
} from "@workspace/api-client-react";
import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";

export type OrganisationType = "client" | "valo" | "consultancy_partner";

export interface OrganisationAccess {
  id: string;
  name: string;
  slug: string;
  type: OrganisationType;
  status: string;
  countryCode: string;
  membershipId: string;
  accessExpiresAt: string | null;
  roles: string[];
  version: number;
}

interface OrganisationContextValue {
  organisations: OrganisationAccess[];
  activeOrganisation: OrganisationAccess | null;
  effectiveRoles: string[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  needsSelection: boolean;
  isSwitching: boolean;
  hasPendingMutation: boolean;
  selectOrganisation: (organisationId: string) => Promise<boolean>;
  refetch: () => void;
}

const OrganisationContext = createContext<OrganisationContextValue | null>(
  null,
);
const SESSION_KEY = "valo:selected-organisation";
const QUERY_PREFIX = "organisation-access";
let activeContextOrganisationId: string | null = null;

setRequestContextGetter(() => ({
  organisationId: activeContextOrganisationId,
}));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOrganisation(value: unknown): OrganisationAccess | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  if (type !== "client" && type !== "valo" && type !== "consultancy_partner")
    return null;
  if (
    typeof value.id !== "string" ||
    value.id.trim() === "" ||
    typeof value.name !== "string" ||
    value.name.trim() === "" ||
    typeof value.slug !== "string" ||
    value.status !== "active" ||
    typeof value.membershipId !== "string" ||
    value.membershipId.trim() === "" ||
    !Array.isArray(value.roles)
  ) {
    return null;
  }
  if (
    value.accessExpiresAt !== null &&
    value.accessExpiresAt !== undefined &&
    typeof value.accessExpiresAt !== "string"
  ) {
    return null;
  }
  if (
    typeof value.accessExpiresAt === "string" &&
    (Number.isNaN(new Date(value.accessExpiresAt).getTime()) ||
      new Date(value.accessExpiresAt).getTime() <= Date.now())
  ) {
    return null;
  }
  const roles = Array.from(
    new Set(
      value.roles.filter((role): role is string => typeof role === "string"),
    ),
  );
  return {
    id: value.id,
    name: value.name,
    slug: value.slug,
    type,
    status: "active",
    countryCode:
      typeof value.countryCode === "string" ? value.countryCode : "NG",
    membershipId: value.membershipId,
    accessExpiresAt:
      typeof value.accessExpiresAt === "string" ? value.accessExpiresAt : null,
    roles,
    version: typeof value.version === "number" ? value.version : 0,
  };
}

async function listOrganisationAccess(): Promise<OrganisationAccess[]> {
  const response = await customFetch<unknown>("/api/organisations", {
    responseType: "json",
  });
  if (!Array.isArray(response)) {
    throw new Error("Organisation access response is not an array");
  }
  const parsed = response.map(parseOrganisation);
  if (parsed.some((organisation) => organisation === null)) {
    throw new Error("Organisation access response contains an invalid record");
  }
  return parsed as OrganisationAccess[];
}

function savedOrganisationId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function saveOrganisationId(value: string | null): void {
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, value);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage can be disabled. The in-memory selection remains authoritative
    // for this page lifetime and the server still validates every request.
  }
}

export function OrganisationProvider({ children }: { children: ReactNode }) {
  const meQuery = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status;
        if (status === 403) return false;
        return failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(400 * 2 ** attempt, 2000),
    },
  });
  const user = meQuery.data;
  const queryClient = useQueryClient();
  const pendingMutations = useIsMutating();
  const [selectedId, setSelectedId] = useState(savedOrganisationId);
  const [isSwitching, setIsSwitching] = useState(false);
  const accessQuery = useQuery({
    queryKey: [QUERY_PREFIX, user?.id ?? "anonymous"],
    queryFn: listOrganisationAccess,
    enabled: Boolean(user && user.status === "active"),
    staleTime: 30_000,
  });

  const organisations = accessQuery.data ?? [];
  const explicitlySelected = organisations.find(
    (organisation) => organisation.id === selectedId,
  );
  const activeOrganisation =
    explicitlySelected ??
    (organisations.length === 1 ? organisations[0] : null);

  // Generated queries read this value immediately when they construct their
  // request. The backend treats it only as a tenant selector and revalidates
  // membership, role grants and access windows.
  activeContextOrganisationId = activeOrganisation?.id ?? null;

  useEffect(() => {
    if (!accessQuery.isSuccess || !selectedId) return;
    if (!organisations.some((organisation) => organisation.id === selectedId)) {
      setSelectedId(null);
      saveOrganisationId(null);
    }
  }, [accessQuery.isSuccess, organisations, selectedId]);

  useEffect(
    () => () => {
      activeContextOrganisationId = null;
    },
    [],
  );

  const selectOrganisation = async (
    organisationId: string,
  ): Promise<boolean> => {
    if (
      isSwitching ||
      queryClient.isMutating() > 0 ||
      !organisations.some((organisation) => organisation.id === organisationId)
    ) {
      return false;
    }

    setIsSwitching(true);
    try {
      await queryClient.cancelQueries({
        predicate: (query) => query.queryKey[0] !== QUERY_PREFIX,
      });
      activeContextOrganisationId = organisationId;
      saveOrganisationId(organisationId);
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== QUERY_PREFIX,
      });
      setSelectedId(organisationId);
      return true;
    } finally {
      setIsSwitching(false);
    }
  };

  const value = useMemo<OrganisationContextValue>(
    () => ({
      organisations,
      activeOrganisation,
      effectiveRoles: activeOrganisation?.roles ?? [],
      isLoading:
        meQuery.isLoading ||
        (Boolean(user && user.status === "active") && accessQuery.isLoading),
      isError: meQuery.isError || accessQuery.isError,
      error: meQuery.error ?? accessQuery.error,
      needsSelection: organisations.length > 1 && !activeOrganisation,
      isSwitching,
      hasPendingMutation: pendingMutations > 0,
      selectOrganisation,
      refetch: () => {
        void accessQuery.refetch();
      },
    }),
    [
      accessQuery,
      activeOrganisation,
      isSwitching,
      meQuery.error,
      meQuery.isError,
      meQuery.isLoading,
      organisations,
      pendingMutations,
      user,
    ],
  );

  return (
    <OrganisationContext.Provider value={value}>
      {children}
    </OrganisationContext.Provider>
  );
}

export function useOrganisationAccess(): OrganisationContextValue | null {
  return useContext(OrganisationContext);
}
