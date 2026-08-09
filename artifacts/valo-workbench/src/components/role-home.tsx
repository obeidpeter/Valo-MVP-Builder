import { useGetMe } from "@workspace/api-client-react";
import { Redirect } from "wouter";
import Dashboard from "@/pages/dashboard";
import { LoadingPanel, StatusPanel } from "@/components/platform-states";
import {
  isClientRole,
  isInternalRole,
  isPartnerRole,
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

  const roles = organisationAccess?.activeOrganisation
    ? organisationAccess.effectiveRoles
    : [String(user.role)];
  if (isClientRole(roles)) return <Redirect to="/portal" />;
  if (isPartnerRole(roles)) return <Redirect to="/partner" />;
  const home = platformHomeForRole(roles);
  if (home !== "/") return <Redirect to={home} />;
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
