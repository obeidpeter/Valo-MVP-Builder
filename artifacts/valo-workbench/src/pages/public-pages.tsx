import type { ReactNode } from "react";
import { Link } from "wouter";
import {
  BadgeCheck,
  Building2,
  Check,
  CircleHelp,
  Landmark,
  LockKeyhole,
  Scale,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { PublicMeta } from "@/components/public/public-meta";
import { BidAutopsyCta } from "@/components/public/public-primary-cta";
import { PublicShell } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";

function PageIntro({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="border-b border-border bg-card">
      <div className="content-shell grid gap-8 py-14 sm:py-18 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">
            {eyebrow}
          </p>
          <h1 className="mt-4 text-balance text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            {description}
          </p>
        </div>
        {children}
      </div>
    </section>
  );
}

function BidAutopsySectionCta() {
  return (
    <section className="border-t border-border bg-accent/45">
      <div className="content-shell flex flex-col gap-6 py-12 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.025em]">
            Start with a review of the tender package.
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Public enquiry does not accept tender files. Sensitive material
            enters only after an authorised engagement and NDA are in place.
          </p>
        </div>
        <BidAutopsyCta className="shrink-0" />
      </div>
    </section>
  );
}

export function ProductPage() {
  const modules = [
    [
      "Pursuit control",
      "Engagement status, reviewer responsibility, deadlines, governance gates and recorded next actions.",
    ],
    [
      "Tender documents",
      "Manifest-led intake, verification status, extraction controls and honest failure states.",
    ],
    [
      "Requirement register",
      "Candidate, confirmed and rejected requirements with exact source references and reviewer attribution.",
    ],
    [
      "Evidence and compliance",
      "Evidence mapping, validity status, renewal signals and claimability boundaries.",
    ],
    [
      "BOQ checks",
      "Exact arithmetic on client-supplied figures, words-versus-figures checks and cited exceptions.",
    ],
    [
      "Issues and red team",
      "Severity-led findings, remediation status and non-overridable fatal release blockers.",
    ],
    [
      "Reports and export",
      "Controlled report generation, named sign-off, provenance and immutable release expectations.",
    ],
    [
      "Activity and audit",
      "Tenant-scoped event history with explicit legacy-integrity status where historical evidence is discontinuous.",
    ],
  ] as const;

  return (
    <PublicShell>
      <PublicMeta
        title="Product"
        description="Explore Valo's evidence-led tender workspaces for intake, cited requirements, evidence, BOQ checks, issues, reports and audit."
        path="/product"
      />
      <PageIntro
        eyebrow="Product"
        title="A controlled workspace for evidence-heavy pursuits."
        description="Valo brings the operational record into one place while keeping AI suggestions, deterministic checks and human decisions visibly separate."
      >
        <Button asChild variant="outline" className="min-h-11">
          <Link href="/how-it-works">See the workflow</Link>
        </Button>
      </PageIntro>

      <section className="content-shell py-16 sm:py-20">
        <div className="grid gap-5 md:grid-cols-2">
          {modules.map(([title, body], index) => (
            <article
              key={title}
              className="rounded-lg border border-border bg-card p-6"
            >
              <p className="font-mono text-xs font-semibold text-primary">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h2 className="mt-4 text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="content-shell grid gap-8 py-14 lg:grid-cols-3">
          <div>
            <BadgeCheck aria-hidden="true" className="size-6 text-primary" />
            <h2 className="mt-4 text-xl font-semibold">
              Authority stays explicit
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              AI can suggest and explain. Only authorised people can confirm
              requirements, approve evidence, sign off or release a package.
            </p>
          </div>
          <div>
            <Scale aria-hidden="true" className="size-6 text-primary" />
            <h2 className="mt-4 text-xl font-semibold">
              Math is not model output
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Money paths use deterministic checks. Valo does not invent rates,
              pricing strategy or commercial assumptions.
            </p>
          </div>
          <div>
            <LockKeyhole aria-hidden="true" className="size-6 text-primary" />
            <h2 className="mt-4 text-xl font-semibold">
              Unavailable means unavailable
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Provider, entitlement and readiness gaps are shown honestly;
              sensitive actions remain disabled rather than simulated.
            </p>
          </div>
        </div>
      </section>
      <BidAutopsySectionCta />
    </PublicShell>
  );
}

export function SolutionsPage() {
  const solutions = [
    {
      icon: Landmark,
      title: "Bid and proposal teams",
      body: "Turn tender instructions into owned, cited actions and keep the response connected to current evidence.",
      items: [
        "Pursuit command centre",
        "Requirements and evidence",
        "BOQ checks",
        "Controlled reports",
      ],
    },
    {
      icon: ShieldCheck,
      title: "Compliance and quality teams",
      body: "Review validity, fatal blockers, remediation and named approvals without losing the source behind a decision.",
      items: [
        "Evidence readiness",
        "Defect review",
        "Red-team controls",
        "Audit exports",
      ],
    },
    {
      icon: Building2,
      title: "Advisory and partner teams",
      body: "Work across assigned client organisations without weakening client ownership, tenant boundaries or Valo quality controls.",
      items: [
        "Delegated workspaces",
        "Role boundaries",
        "Partner attribution",
        "Commercial feature gates",
      ],
    },
  ] as const;

  return (
    <PublicShell>
      <PublicMeta
        title="Solutions"
        description="Valo supports bid, compliance and advisory teams with source-backed tender workflows and controlled human review."
        path="/solutions"
      />
      <PageIntro
        eyebrow="Solutions"
        title="The same evidence record, shaped for each responsibility."
        description="Valo changes what each role can see and do without creating separate versions of the truth."
      />
      <section className="content-shell grid gap-5 py-16 sm:py-20 lg:grid-cols-3">
        {solutions.map((solution) => (
          <article
            key={solution.title}
            className="rounded-lg border border-border bg-card p-6"
          >
            <solution.icon aria-hidden="true" className="size-6 text-primary" />
            <h2 className="mt-5 text-xl font-semibold">{solution.title}</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {solution.body}
            </p>
            <ul className="mt-6 space-y-3 border-t border-border pt-5 text-sm">
              {solution.items.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <Check aria-hidden="true" className="size-4 text-success" />
                  {item}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
      <BidAutopsySectionCta />
    </PublicShell>
  );
}

export function HowItWorksPage() {
  const stages = [
    [
      "Engagement first",
      "An authorised team records the client context, NDA, conflict position, SLA class and named reviewer. Public lead capture never accepts tender files.",
    ],
    [
      "Manifest and bound intake",
      "Valo records the document manifest and enforces configured byte limits. Authoritative MIME detection, malware scanning, archive inspection and quarantine are not yet wired, so production document intake remains gated on approved controls.",
    ],
    [
      "Extract into review",
      "Candidate obligations carry source locations and uncertainty. Embedded document instructions cannot invoke tools or change workflow state.",
    ],
    [
      "Confirm and assign",
      "A named reviewer confirms, edits or rejects each candidate before it becomes an authoritative requirement.",
    ],
    [
      "Map evidence",
      "Current evidence is linked to requirements. Unsupported or expired evidence stays visible and cannot silently support a claim.",
    ],
    [
      "Check and challenge",
      "Deterministic BOQ checks and reviewer-led defect/red-team work surface controllable risks without predicting award.",
    ],
    [
      "Approve and release",
      "Readiness gates, reviewer assignment and sign-off state are rechecked at export. Fatal blockers remain non-overridable.",
    ],
    [
      "Preserve the record",
      "The released artefact, decisions and audit provenance remain attributable after delivery.",
    ],
  ] as const;

  return (
    <PublicShell>
      <PublicMeta
        title="How it works"
        description="Follow Valo's controlled path from NDA-gated intake to cited requirements, evidence, review, approval and audit-ready release."
        path="/how-it-works"
      />
      <PageIntro
        eyebrow="How it works"
        title="A review process with explicit gates."
        description="Each stage produces a record the next stage can rely on. Missing authority, evidence or infrastructure stops the action instead of being papered over."
      />
      <section className="content-shell py-16 sm:py-20">
        <ol className="mx-auto max-w-4xl space-y-4">
          {stages.map(([title, body], index) => (
            <li
              key={title}
              className="grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-[3rem_1fr] sm:p-6"
            >
              <span className="font-mono text-sm font-semibold text-primary">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h2 className="font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <BidAutopsySectionCta />
    </PublicShell>
  );
}

export function SecurityPage() {
  const controls = [
    [
      "Tenant boundary",
      "Requests carry an explicitly selected organisation and the data layer applies tenant context. Missing context fails closed.",
    ],
    [
      "Human authority",
      "Role permissions distinguish contribution, review, quality, administration and audit. Partner access does not grant Valo quality authority.",
    ],
    [
      "Hostile-input boundary",
      "Tender content is treated as data, never system instruction, and configured byte limits reduce exposure. Authoritative MIME detection, malware scanning, archive inspection and quarantine are not yet wired into intake.",
    ],
    [
      "Audit integrity",
      "Active audit events are hash-chained. Preserved legacy history is labelled honestly where its historical chain contains a known discontinuity.",
    ],
    [
      "Provider readiness boundary",
      "Model-assisted actions remain unavailable unless the relevant provider is explicitly approved. Malware inspection is not yet an authoritative intake gate and must not be inferred from provider configuration.",
    ],
    [
      "Release gates",
      "Readiness, evidence, reviewer and defect controls are re-evaluated when a report or export is requested.",
    ],
  ] as const;

  return (
    <PublicShell>
      <PublicMeta
        title="Security"
        description="Understand Valo's tenant, input-security, provider-readiness, audit and human-authority controls."
        path="/security"
      />
      <PageIntro
        eyebrow="Security and trust"
        title="Controls that are visible when they matter."
        description="Valo is designed to make security and integrity state part of the workflow. This page describes product controls, not a certification or blanket assurance."
      />
      <section className="content-shell py-16 sm:py-20">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {controls.map(([title, body]) => (
            <article
              key={title}
              className="rounded-lg border border-border bg-card p-6"
            >
              <LockKeyhole aria-hidden="true" className="size-5 text-primary" />
              <h2 className="mt-5 font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {body}
              </p>
            </article>
          ))}
        </div>
        <div className="mt-8 rounded-lg border border-warning/40 bg-warning/10 p-5">
          <h2 className="font-semibold text-warning-foreground">
            Deployment matters
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
            Source controls do not prove that every production provider, region,
            key, recovery process or endpoint policy is approved. Sensitive
            actions remain subject to environment-specific readiness and
            operational review.
          </p>
        </div>
      </section>
      <BidAutopsySectionCta />
    </PublicShell>
  );
}

export function AboutPage() {
  return (
    <PublicShell>
      <PublicMeta
        title="About"
        description="Valo is building an evidence-led tender operating system for Nigerian and regulated-market bid teams."
        path="/about"
      />
      <PageIntro
        eyebrow="About Valo"
        title="Better tender operations begin with a better record."
        description="Valo is being built from Abuja for teams working across Nigerian public procurement, energy-sector and donor-funded tender environments."
      />
      <section className="content-shell grid gap-10 py-16 sm:py-20 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.025em]">
            Why Valo exists
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Bid teams often have capable people and strong experience, yet lose
            control of requirements, evidence and approvals across documents,
            messages and spreadsheets. Valo focuses on those controllable
            process failures.
          </p>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Valo is designed to combine model-assisted extraction and
            explanation with deterministic software and named human review.
            Model-assisted steps remain unavailable unless provider, privacy and
            evaluation gates are approved; human review remains the final
            authority.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="font-semibold">Operating commitments</h2>
          <ul className="mt-5 space-y-4">
            {[
              "No guarantee of contract award or evaluator behaviour.",
              "No invention of evidence, experience, pricing or approvals.",
              "No administrative override of open fatal blockers.",
              "No government-portal submission automation.",
              "Client data is not approved for shared-model training.",
            ].map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 text-sm leading-6"
              >
                <Check
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0 text-success"
                />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <BidAutopsySectionCta />
    </PublicShell>
  );
}

export function ContactPage() {
  return (
    <PublicShell>
      <PublicMeta
        title="Contact"
        description="Start a Valo Bid Autopsy enquiry without sending tender documents or sensitive commercial information through a public form."
        path="/contact"
      />
      <PageIntro
        eyebrow="Contact"
        title="Start with a Bid Autopsy request."
        description="The canonical request journey collects only the ordinary business details Valo needs for first contact. Tender files are handled later, after the appropriate engagement and approved document-sharing gates."
      />
      <section className="content-shell grid gap-6 py-16 sm:py-20 lg:grid-cols-[1fr_0.75fr]">
        <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
          <UsersRound aria-hidden="true" className="size-6 text-primary" />
          <h2 className="mt-5 text-2xl font-semibold">New bid enquiry</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Use one protected request route for live, draft or previously
            submitted bids. Do not send confidential bid content, credentials or
            financial schedules at this stage.
          </p>
          <BidAutopsyCta className="mt-7" />
        </div>
        <aside className="rounded-lg border border-border bg-muted/45 p-6">
          <CircleHelp aria-hidden="true" className="size-6 text-primary" />
          <h2 className="mt-5 font-semibold">Already invited?</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Use the same email or identity provider tied to your invitation.
            Organisation and role selection happen after authentication.
          </p>
          <Button asChild variant="outline" className="mt-6 min-h-11 w-full">
            <Link href="/sign-in">Sign In to Valo</Link>
          </Button>
        </aside>
      </section>
    </PublicShell>
  );
}

function LegalPage({
  kind,
  title,
  description,
  children,
}: {
  kind: "Privacy" | "Terms";
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <PublicShell>
      <PublicMeta
        title={kind}
        description={description}
        path={`/${kind.toLowerCase()}`}
      />
      <PageIntro eyebrow={kind} title={title} description={description} />
      <article className="content-shell max-w-4xl py-14 sm:py-18">
        <div className="prose prose-slate max-w-none prose-headings:font-sans prose-headings:tracking-tight prose-a:text-primary">
          {children}
        </div>
      </article>
    </PublicShell>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage
      kind="Privacy"
      title="Privacy notice"
      description="How this Valo web experience handles public enquiries, account identity and tender-workspace information."
    >
      <p>
        <strong>Effective 10 August 2026.</strong> This notice describes the
        current product design and is not a claim that every optional
        integration is active in every environment.
      </p>
      <h2>Public website</h2>
      <p>
        The Bid Autopsy request form records ordinary business contact details,
        a broad tender category and stage, an optional deadline, preferred
        contact method and privacy acknowledgement. Valo uses this information
        to assess and respond to the enquiry. The form does not accept tender
        documents, sensitive commercial information or free-text bid details.
      </p>
      <p>
        Form contents are stored in Valo's isolated public-intake database and
        are not sent to analytics. Request metadata is used for shared
        same-origin, abuse-prevention, rate-limit and idempotency controls. The
        ordinary application log does not record form contents.
      </p>
      <h2>Public-enquiry retention</h2>
      <p>
        Retention and deletion of public enquiries follow the approved
        public-lead policy. This notice does not publish a fixed period where no
        duration has been operationally approved. Use a verified Valo contact
        for access, correction or deletion requests relating to a public
        enquiry.
      </p>
      <h2>Accounts and access</h2>
      <p>
        Valo uses an external identity provider for sign-in, verification,
        multi-factor authentication and recovery. The application stores the
        minimum identity and role references needed to enforce organisation
        access and produce audit records.
      </p>
      <h2>Tender workspace data</h2>
      <p>
        Tender and evidence data is organisation-scoped. Access, storage and
        model-processing actions are subject to engagement, tenant, role and
        provider-readiness controls. Do not use public enquiry channels for this
        material.
      </p>
      <h2>Audit, security and retention</h2>
      <p>
        Authorised actions may be recorded in an audit trail. Retention,
        deletion and legal-hold decisions depend on the engagement and
        applicable policy; a request is not completed until the system records
        its authorised outcome.
      </p>
      <h2>Your choices</h2>
      <p>
        Use the verified relationship contact or your organisation administrator
        for access, correction, retention or deletion requests.
        Security-sensitive requests may require reauthentication and additional
        approval.
      </p>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage
      kind="Terms"
      title="Service terms notice"
      description="Plain-language boundaries for using the Valo public site and controlled tender workspace."
    >
      <p>
        <strong>Effective 9 August 2026.</strong> Contract-specific terms,
        data-processing terms and service levels are governed by the agreement
        issued to the relevant organisation.
      </p>
      <h2>Authorised use</h2>
      <p>
        The tender workspace is invitation-only. Users must act for the selected
        organisation, protect their credentials and use only the roles and
        client workspaces they are authorised to access.
      </p>
      <h2>Human responsibility</h2>
      <p>
        Valo assists a reviewed process. It does not guarantee contract award,
        evaluator behaviour or acceptance of a submission. Authorised users
        remain responsible for conclusions, evidence, figures, approvals and
        submission.
      </p>
      <h2>Prohibited use</h2>
      <p>
        Users must not attempt cross-tenant access, bypass readiness controls,
        introduce malicious files, treat model output as unreviewed authority,
        fabricate evidence, or use Valo to automate government-portal
        submission.
      </p>
      <h2>Commercial and financial boundaries</h2>
      <p>
        BOQ tools check client-supplied figures and formats. They do not create
        pricing strategy, invent rates or provide financial advice.
      </p>
      <h2>Availability and change</h2>
      <p>
        Features may be unavailable where entitlement, infrastructure, provider
        or security controls are not approved. Valo may change the service to
        preserve security, integrity or legal obligations, with material
        contractual changes handled under the applicable agreement.
      </p>
    </LegalPage>
  );
}

export function PublicNotFoundPage() {
  return (
    <PublicShell>
      <PublicMeta
        title="Page not found"
        description="The requested Valo page could not be found."
        path={window.location.pathname}
        index={false}
      />
      <section className="content-shell flex min-h-[60vh] items-center py-16">
        <div className="max-w-xl">
          <p className="font-mono text-sm font-semibold text-primary">404</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">
            This page is not available.
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            The address may have changed, or the resource may belong to an
            authenticated organisation workspace.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/">Return home</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
