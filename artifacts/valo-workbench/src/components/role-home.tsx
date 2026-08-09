import { useGetMe } from "@workspace/api-client-react";
import { Redirect } from "wouter";
import Dashboard from "@/pages/dashboard";
import { LoadingPanel, StatusPanel } from "@/components/platform-states";
import {
  isInternalRole,
  platformFeatureFlags,
  platformHomeForRole,
} from "@/lib/platform-access";
import { useOrganisationAccess } from "@/contexts/organisation-context";

export default function RoleHome() {
  const { data: user, isLoading, error } = useGetMe();
  const organisationAccess = useOrganisationAccess();

  if (isLoading || organisationAccess?.isLoading) {
    return (
      <div className="p-6 sm:p-8">
        <LoadingPanel label="Opening your workspace" />
      </div>
    );
  }

  if (error || !user || organisationAccess?.isError) {
    return (
      <div className="p-6 sm:p-8">
        <StatusPanel
          state="error"
          title="Workspace unavailable"
          description="Your role could not be resolved for this session."
        />
      </div>
    );
  }

  if (!organisationAccess?.activeOrganisation) {
    return (
      <div className="p-6 sm:p-8">
        <StatusPanel
          state="pending"
          title="No organisation workspace selected"
          description="Choose an active organisation, or wait for access to be assigned. Legacy account roles do not open tenant data."
        />
      </div>
    );
  }

  const roles = organisationAccess.effectiveRoles;
  const home = platformHomeForRole(
    roles,
    platformFeatureFlags(),
    organisationAccess.effectivePermissions,
  );
  if (home !== "/app") return <Redirect to={home} />;
  if (isInternalRole(roles)) return <Dashboard />;

  return (
    <div className="p-6 sm:p-8">
      <StatusPanel
        state="blocked"
        title="No workspace assigned"
        description="Your account does not currently have an active platform role."
      />
    </div>
  );
}
