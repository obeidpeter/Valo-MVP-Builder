import { Switch, Route } from "wouter";
import NotFound from "@/pages/not-found";
import Clients from "@/pages/clients";
import ClientDetails from "@/pages/client-details";
import Projects from "@/pages/projects";
import ProjectDetails from "@/pages/project-details";
import SbdCorpus from "@/pages/sbd";
import SbdDetails from "@/pages/sbd-details";
import Settings from "@/pages/settings";
import RequireAdmin from "@/components/require-admin";
import RequireArea from "@/components/require-area";
import RoleHome from "@/components/role-home";
import ClientPortal from "@/pages/client-portal";
import OperationsConsole from "@/pages/operations-console";
import PartnerWorkspace from "@/pages/partner-workspace";
import BillingEntitlements from "@/pages/billing-entitlements";
import NotificationsConsole from "@/pages/notifications-console";
import SecurityAudit from "@/pages/security-audit";
import EvidenceReadiness from "@/pages/evidence-readiness";

export default function ProtectedRoutes() {
  return (
    <Switch>
      <Route path="/" component={RoleHome} />
      <Route path="/clients">
        <RequireArea area="workbench">
          <Clients />
        </RequireArea>
      </Route>
      <Route path="/clients/:id">
        <RequireArea area="workbench">
          <ClientDetails />
        </RequireArea>
      </Route>
      <Route path="/projects">
        <RequireArea area="workbench">
          <Projects />
        </RequireArea>
      </Route>
      <Route path="/projects/:id">
        <RequireArea area="workbench">
          <ProjectDetails />
        </RequireArea>
      </Route>
      <Route path="/sbd">
        <RequireArea area="workbench">
          <SbdCorpus />
        </RequireArea>
      </Route>
      <Route path="/sbd/:id">
        <RequireArea area="workbench">
          <SbdDetails />
        </RequireArea>
      </Route>
      <Route path="/operations">
        <RequireArea area="operations">
          <OperationsConsole />
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
      <Route path="/security">
        <RequireArea area="security_audit">
          <SecurityAudit />
        </RequireArea>
      </Route>
      <Route path="/settings">
        <RequireAdmin>
          <Settings />
        </RequireAdmin>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}
