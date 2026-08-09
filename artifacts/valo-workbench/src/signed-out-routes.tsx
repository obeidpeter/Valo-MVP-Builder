import { Route, Switch } from "wouter";
import LandingPage from "@/pages/landing";
import {
  AboutPage,
  ContactPage,
  HowItWorksPage,
  PrivacyPage,
  ProductPage,
  PublicNotFoundPage,
  SecurityPage,
  SolutionsPage,
  TermsPage,
} from "@/pages/public-pages";

export default function SignedOutRoutes() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/product" component={ProductPage} />
      <Route path="/solutions" component={SolutionsPage} />
      <Route path="/how-it-works" component={HowItWorksPage} />
      <Route path="/security" component={SecurityPage} />
      <Route path="/about" component={AboutPage} />
      <Route path="/contact" component={ContactPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/terms" component={TermsPage} />
      <Route component={PublicNotFoundPage} />
    </Switch>
  );
}
