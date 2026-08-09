import type { ReactNode } from "react";
import { useGetMe } from "@workspace/api-client-react";
import {
  getPlatformAccessDecision,
  platformFeatureFlags,
  type PlatformArea,
} from "@/lib/platform-access";
import { LoadingPanel, StatusPanel } from "@/components/platform-states";
import { useOrganisationAccess } from "@/contexts/organisation-context";

export default function RequireArea({
  area,
  children,
}: {
  area: PlatformArea;
  children: ReactNode;
}) {
  const { data: user, isLoading, error } = useGetMe();
  const organisationAccess = useOrganisationAccess();

  if (isLoading || organisationAccess?.isLoading) {
    return (
      <div className="p-6 sm:p-8">
        <LoadingPanel label="Checking workspace access" />
      </div>
    );
  }

  if (error || !user || organisationAccess?.isError) {
    return (
      <div className="p-6 sm:p-8">
        <StatusPanel
          state="error"
          title="Access could not be verified"
          description="The current session could not be matched to a platform role. Refresh after connectivity and identity services recover."
        />
      </div>
    );
  }

  const roles = organisationAccess?.activeOrganisation
    ? organisationAccess.effectiveRoles
    : [String(user.role)];
  const decision = getPlatformAccessDecision(
    roles,
    area,
    platformFeatureFlags(),
  );
  if (!decision.allowed) {
    return (
      <div className="p-6 sm:p-8">
        <StatusPanel
          state="blocked"
          title="Access denied"
          description={
            decision.reason +
            " This decision is enforced by the server; contact an organisation administrator if the assignment is incorrect."
          }
        />
      </div>
    );
  }

  return <>{children}</>;
}
