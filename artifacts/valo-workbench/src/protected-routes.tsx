import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import RequireAdmin from "@/components/require-admin";
import RequireArea from "@/components/require-area";
import { LoadingPanel } from "@/components/platform-states";

const RoleHome = lazy(() => import("@/components/role-home"));
const NotFound = lazy(() => import("@/pages/not-found"));
const Clients = lazy(() => import("@/pages/clients"));
const ClientDetails = lazy(() => import("@/pages/client-details"));
const Projects = lazy(() => import("@/pages/projects"));
const ProjectDetails = lazy(() => import("@/pages/project-details"));
const SbdCorpus = lazy(() => import("@/pages/sbd"));
const SbdDetails = lazy(() => import("@/pages/sbd-details"));
const Settings = lazy(() => import("@/pages/settings"));
const ClientPortal = lazy(() => import("@/pages/client-portal"));
const OperationsConsole = lazy(() => import("@/pages/operations-console"));
const IntelligenceCentre = lazy(
  () => import("@/pages/intelligence-centre-route"),
);
const PartnerWorkspace = lazy(() => import("@/pages/partner-workspace"));
const BillingEntitlements = lazy(() => import("@/pages/billing-entitlements"));
const NotificationsConsole = lazy(
  () => import("@/pages/notifications-console"),
);
const SecurityAudit = lazy(() => import("@/pages/security-audit"));
const EvidenceReadiness = lazy(() => import("@/pages/evidence-readiness"));
const ReportsIndex = lazy(() => import("@/pages/reports-index"));
const AccountPage = lazy(() => import("@/pages/account"));
const OrganisationSettings = lazy(
  () => import("@/pages/organisation-settings"),
);

export default function ProtectedRoutes() {
  return (
    <Suspense
      fallback={
        <div className="p-6 sm:p-8">
          <LoadingPanel label="Loading workspace view" />
        </div>
      }
    >
      <Switch>
        <Route path="/app" component={RoleHome} />
        <Route path="/dashboard" component={RoleHome} />
        <Route path="/clients">
          <RequireArea area="pursuit_workbench">
            <Clients />
          </RequireArea>
        </Route>
        <Route path="/clients/:id">
          <RequireArea area="pursuit_workbench">
            <ClientDetails />
          </RequireArea>
        </Route>
        <Route path="/projects">
          <RequireArea area="pursuit_workbench">
            <Projects />
          </RequireArea>
        </Route>
        <Route path="/projects/:id">
          <RequireArea area="pursuit_workbench">
            <ProjectDetails />
          </RequireArea>
        </Route>
        <Route path="/sbd">
          <RequireArea area="pursuit_workbench">
            <SbdCorpus />
          </RequireArea>
        </Route>
        <Route path="/sbd/:id">
          <RequireArea area="pursuit_workbench">
            <SbdDetails />
          </RequireArea>
        </Route>
        <Route path="/operations">
          <RequireArea area="operations">
            <OperationsConsole />
          </RequireArea>
        </Route>
        <Route path="/intelligence">
          <RequireArea area="pursuit_workbench">
            <IntelligenceCentre />
          </RequireArea>
        </Route>
        <Route path="/portal">
          <RequireArea area="client_portal">
            <ClientPortal />
          </RequireArea>
        </Route>
        <Route path="/partner">
          <RequireArea area="partner_workspace">
            <PartnerWorkspace />
          </RequireArea>
        </Route>
        <Route path="/evidence-readiness">
          <RequireArea area="evidence_readiness">
            <EvidenceReadiness />
          </RequireArea>
        </Route>
        <Route path="/reports">
          <RequireArea area="pursuit_workbench">
            <ReportsIndex />
          </RequireArea>
        </Route>
        <Route path="/billing">
          <RequireArea area="billing_entitlements">
            <BillingEntitlements />
          </RequireArea>
        </Route>
        <Route path="/notifications">
          <RequireArea area="notifications">
            <NotificationsConsole />
          </RequireArea>
        </Route>
        <Route path="/app/security">
          <RequireArea area="security_audit">
            <SecurityAudit />
          </RequireArea>
        </Route>
        <Route path="/organisation-settings">
          <RequireArea area="organisation_settings">
            <OrganisationSettings />
          </RequireArea>
        </Route>
        <Route path="/settings">
          <RequireAdmin>
            <Settings />
          </RequireAdmin>
        </Route>
        <Route path="/account" component={AccountPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}
