import { Switch, Route } from "wouter";
import SignInPage from "@/pages/sign-in";
import LandingPage from "@/pages/landing";

export default function SignedOutRoutes() {
  return (
    <Switch>
      <Route path="/sign-in" component={SignInPage} />
      <Route path="/" component={LandingPage} />
      <Route component={LandingPage} />
    </Switch>
  );
}
