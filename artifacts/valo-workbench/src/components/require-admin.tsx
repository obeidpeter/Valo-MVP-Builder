import { useGetMe } from "@workspace/api-client-react";
import {
  getPlatformAccessDecision,
  platformFeatureFlags,
} from "@/lib/platform-access";
import { LoadingPanel, StatusPanel } from "@/components/platform-states";
import { useOrganisationAccess } from "@/contexts/organisation-context";

export default function RequireAdmin({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading } = useGetMe();
  const organisationAccess = useOrganisationAccess();

  if (isLoading || organisationAccess?.isLoading) {
    return (
      <div className="p-6 sm:p-8">
        <LoadingPanel label="Checking administrative access" />
      </div>
    );
  }

  const decision = getPlatformAccessDecision(
    organisationAccess?.activeOrganisation
      ? organisationAccess.effectiveRoles
      : undefined,
    "settings",
    platformFeatureFlags(),
    organisationAccess?.activeOrganisation
      ? organisationAccess.effectivePermissions
      : [],
  );

  if (!decision.allowed) {
    return (
      <div className="p-6 sm:p-8">
        <StatusPanel
          state="blocked"
          title="Access denied"
          description="Settings are restricted to authorised operations administrators. Server authorisation remains authoritative."
        />
      </div>
    );
  }

  return <>{children}</>;
}
