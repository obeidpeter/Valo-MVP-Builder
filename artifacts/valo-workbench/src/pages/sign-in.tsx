import {
  AuthenticateWithRedirectCallback,
  ClerkLoaded,
  ClerkLoading,
  SignIn,
  SignUp,
} from "@clerk/clerk-react";
import { Link } from "wouter";
import { ArrowLeft, Check, LockKeyhole } from "lucide-react";
import { PublicMeta } from "@/components/public/public-meta";
import { ValoMark } from "@/components/valo-mark";
import { safePostAuthRedirect } from "@/lib/safe-redirect";

function safeRedirectTarget(): string {
  const requested = new URLSearchParams(window.location.search).get(
    "redirect_url",
  );
  return safePostAuthRedirect(requested, window.location.origin);
}

const clerkAppearance = {
  elements: {
    rootBox: "w-full",
    cardBox: "w-full shadow-none",
    card: "w-full border-0 bg-transparent p-0 shadow-none",
    headerTitle: "text-foreground text-2xl font-semibold tracking-tight",
    headerSubtitle: "text-muted-foreground",
    formButtonPrimary:
      "min-h-11 bg-primary text-primary-foreground hover:bg-primary/90 shadow-none",
    formFieldLabel: "text-foreground text-sm",
    formFieldInput:
      "min-h-11 rounded-md border-border bg-background text-foreground shadow-none",
    socialButtonsBlockButton:
      "min-h-11 border-border bg-background text-foreground shadow-none hover:bg-muted",
    dividerLine: "bg-border",
    dividerText: "text-muted-foreground",
    identityPreview: "border-border bg-muted",
    footerActionText: "text-muted-foreground",
    footerActionLink: "text-primary hover:text-primary/80",
    alert: "border-border bg-muted text-foreground",
  },
} as const;

function AccessLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <a
        href="#access-main"
        className="sr-only z-50 rounded-md bg-card px-4 py-2 text-sm font-medium shadow-sm focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to access form
      </a>
      <div className="grid min-h-screen lg:grid-cols-[0.88fr_1.12fr]">
        <aside className="hidden bg-[#0d1b2f] px-10 py-12 text-white lg:flex lg:flex-col lg:justify-between xl:px-16">
          <Link
            href="/"
            className="w-fit rounded-md text-[#74d6c4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ValoMark label="Valo" />
          </Link>
          <div className="max-w-lg py-16">
            <p className="text-sm font-semibold uppercase tracking-[0.13em] text-[#74d6c4]">
              Controlled access
            </p>
            <h1 className="mt-5 text-balance text-4xl font-semibold leading-tight tracking-[-0.04em]">
              {title}
            </h1>
            <p className="mt-5 text-base leading-7 text-slate-300">
              {description}
            </p>
            <ul className="mt-8 space-y-4 text-sm text-slate-200">
              {[
                "Organisation and role access resolved after sign-in",
                "Multi-factor and recovery handled by the identity provider",
                "Protected actions recorded against the authenticated identity",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-[#74d6c4]"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs leading-5 text-slate-400">
            Never approve an unexpected MFA prompt. Contact your authorised
            organisation administrator if an invitation or recovery request
            looks unfamiliar.
          </p>
        </aside>

        <main
          id="access-main"
          className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-8"
        >
          <div className="w-full max-w-md">
            <div className="mb-8 flex items-center justify-between lg:hidden">
              <Link href="/" className="rounded-md text-primary">
                <ValoMark />
              </Link>
              <Link
                href="/"
                className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
                Home
              </Link>
            </div>
            <div className="rounded-xl border border-border bg-card p-5 sm:p-7">
              <ClerkLoading>
                <div
                  className="flex min-h-72 items-center justify-center"
                  role="status"
                >
                  <div className="text-center">
                    <LockKeyhole
                      aria-hidden="true"
                      className="mx-auto size-6 text-primary"
                    />
                    <p className="mt-3 text-sm text-muted-foreground">
                      Loading secure access…
                    </p>
                  </div>
                </div>
              </ClerkLoading>
              <ClerkLoaded>{children}</ClerkLoaded>
            </div>
            <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
              Valo is invitation-only. Sign-in does not grant access to an
              organisation or tender workspace without an active
              server-authorised membership.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <AccessLayout
      title="Return to the work, with the right authority."
      description="Valo keeps tender records behind verified identity, explicit organisation selection and role-aware controls."
    >
      <PublicMeta
        title="Sign in"
        description="Secure, invitation-only access to the Valo tender workspace."
        path="/sign-in"
        index={false}
      />
      <SignIn
        routing="hash"
        fallbackRedirectUrl={safeRedirectTarget()}
        signUpUrl="/accept-invitation"
        appearance={clerkAppearance}
      />
    </AccessLayout>
  );
}

export function InvitationPage() {
  return (
    <AccessLayout
      title="Activate an authorised invitation."
      description="Use the invited identity. Valo will still verify the corresponding organisation membership and assigned role before opening a workspace."
    >
      <PublicMeta
        title="Accept invitation"
        description="Activate an authorised Valo invitation and complete provider-managed verification."
        path="/accept-invitation"
        index={false}
      />
      <SignUp
        routing="hash"
        fallbackRedirectUrl={safeRedirectTarget()}
        signInUrl="/sign-in"
        appearance={clerkAppearance}
      />
    </AccessLayout>
  );
}

export function AccessCallbackPage() {
  return (
    <AccessLayout
      title="Completing secure sign-in."
      description="The identity provider is returning control to Valo. No tender workspace opens until the session and organisation membership are verified."
    >
      <PublicMeta
        title="Completing sign in"
        description="Complete the secure identity-provider return to Valo."
        path="/sso-callback"
        index={false}
      />
      <AuthenticateWithRedirectCallback />
    </AccessLayout>
  );
}
