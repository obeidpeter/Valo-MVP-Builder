import { UserProfile } from "@clerk/clerk-react";
import { PageHeader } from "@/components/platform-states";
import { useOrganisationAccess } from "@/contexts/organisation-context";

function roleLabel(role: string): string {
  return role
    .replace(/^client_/, "")
    .replace(/^consultancy_/, "")
    .replace(/^valo_/, "Valo ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AccountPage() {
  const access = useOrganisationAccess();
  return (
    <div className="mx-auto w-full max-w-6xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Account and identity"
        title="Profile and security"
        description="Manage the provider-backed identity for this session. Organisation roles and access are granted separately by authorised administrators."
        state="active"
      />
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Current organisation context</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Organisation</dt>
            <dd className="mt-1 font-medium">
              {access?.activeOrganisation?.name ?? "Not selected"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Effective roles</dt>
            <dd className="mt-1 font-medium">
              {access?.effectiveRoles.length
                ? access.effectiveRoles.map(roleLabel).join(", ")
                : "No active role"}
            </dd>
          </div>
        </dl>
      </section>
      <section
        aria-labelledby="identity-provider-heading"
        className="space-y-3"
      >
        <div>
          <h2 id="identity-provider-heading" className="text-lg font-semibold">
            Identity-provider settings
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Password, verification, multi-factor authentication, active sessions
            and recovery are handled by Clerk.
          </p>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card p-2 sm:p-4">
          <UserProfile
            routing="hash"
            appearance={{
              elements: {
                rootBox: "w-full",
                cardBox: "w-full shadow-none",
                card: "w-full shadow-none border-0 bg-card",
                navbar: "border-border",
                pageScrollBox: "p-0 sm:p-2",
              },
            }}
          />
        </div>
      </section>
    </div>
  );
}
