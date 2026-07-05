import { Switch, Route } from "wouter";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Clients from "@/pages/clients";
import ClientDetails from "@/pages/client-details";
import Projects from "@/pages/projects";
import ProjectDetails from "@/pages/project-details";
import SbdCorpus from "@/pages/sbd";
import SbdDetails from "@/pages/sbd-details";
import Settings from "@/pages/settings";
import RequireAdmin from "@/components/require-admin";

export default function ProtectedRoutes() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/clients" component={Clients} />
      <Route path="/clients/:id" component={ClientDetails} />
      <Route path="/projects" component={Projects} />
      <Route path="/projects/:id" component={ProjectDetails} />
      <Route path="/sbd" component={SbdCorpus} />
      <Route path="/sbd/:id" component={SbdDetails} />
      <Route path="/settings">
        <RequireAdmin>
          <Settings />
        </RequireAdmin>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}
