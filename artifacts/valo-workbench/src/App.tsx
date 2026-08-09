import { Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider, SignedIn, SignedOut } from "@clerk/clerk-react";
import SignedOutRoutes from "@/signed-out-routes";
import ProtectedRoutes from "@/protected-routes";
import Layout from "@/components/layout";
import { OrganisationProvider } from "@/contexts/organisation-context";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function ProtectedApp() {
  return (
    <OrganisationProvider>
      <Layout>
        <ProtectedRoutes />
      </Layout>
    </OrganisationProvider>
  );
}

function App() {
  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4 text-center">
        <div className="max-w-md space-y-4">
          <h1 className="text-xl font-bold text-destructive">
            Missing Clerk Configuration
          </h1>
          <p className="text-muted-foreground">
            VITE_CLERK_PUBLISHABLE_KEY is not set in your environment variables.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      proxyUrl={import.meta.env.VITE_CLERK_PROXY_URL}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <SignedIn>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <ProtectedApp />
            </WouterRouter>
          </SignedIn>
          <SignedOut>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <SignedOutRoutes />
            </WouterRouter>
          </SignedOut>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
