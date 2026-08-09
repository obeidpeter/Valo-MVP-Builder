import { Link } from "wouter";
import {
  ArrowRight,
  BadgeCheck,
  Calculator,
  Check,
  FileCheck2,
  FileSearch,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { PublicMeta } from "@/components/public/public-meta";
import { PublicShell } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";

const workflow = [
  {
    number: "01",
    title: "Control intake",
    body: "Record the engagement, NDA, conflict position and document manifest before tender material enters the workspace.",
  },
  {
    number: "02",
    title: "Extract with citations",
    body: "Surface candidate requirements with page and clause references. AI suggestions remain pending until a named reviewer confirms them.",
  },
  {
    number: "03",
    title: "Link evidence and check figures",
    body: "Map current evidence, expose gaps and verify client-supplied BOQ arithmetic without inventing rates or commercial strategy.",
  },
  {
    number: "04",
    title: "Review, approve and release",
    body: "Route findings through quality review, preserve fatal blockers and produce a controlled, attributable export.",
  },
] as const;

const capabilities = [
  {
    icon: FileSearch,
    title: "Requirement control",
    body: "A cited requirement register with confirmation state, owner, due date and evidence expectation.",
  },
  {
    icon: Layers3,
    title: "Evidence readiness",
    body: "Tenant-scoped evidence records, expiry signals and claimability rules that keep unsupported claims out of deliverables.",
  },
  {
    icon: Calculator,
    title: "BOQ verification",
    body: "Deterministic checks on client-supplied quantities, rates, extensions and totals, using exact integer-kobo arithmetic.",
  },
  {
    icon: ShieldCheck,
    title: "Defect and red-team review",
    body: "Severity-led findings and hostile-evaluator review, with unresolved fatal issues remaining release blockers.",
  },
  {
    icon: UsersRound,
    title: "Named approvals",
    body: "Role-aware review and sign-off that records who approved what, when, and against which evidence state.",
  },
  {
    icon: FileCheck2,
    title: "Controlled reporting",
    body: "Reports and exports generated from recorded facts, with provenance and audit history carried into release.",
  },
] as const;

const trustPoints = [
  "Exact source citations",
  "Named human review",
  "Deterministic arithmetic",
  "Tenant isolation",
] as const;

function ProductPreview() {
  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-card"
      aria-label="Illustrative Valo pursuit workspace"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-success" />
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Illustrative workflow
          </span>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
          Human review required
        </span>
      </div>
      <div className="grid min-h-[25rem] md:grid-cols-[13rem_1fr]">
        <div className="hidden border-r border-border bg-muted/45 p-4 md:block">
          <p className="text-sm font-semibold">Pursuit workspace</p>
          <div className="mt-5 space-y-2 text-sm">
            {[
              "Overview",
              "Tender documents",
              "Requirements",
              "Evidence",
              "BOQ",
              "Issues",
              "Package",
            ].map((item, index) => (
              <div
                key={item}
                className={
                  index === 2
                    ? "rounded-md bg-card px-3 py-2 font-medium text-primary"
                    : "px-3 py-2 text-muted-foreground"
                }
              >
                {item}
              </div>
            ))}
          </div>
        </div>
        <div className="p-4 sm:p-6">
          <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Requirements register
              </p>
              <p className="mt-1 text-lg font-semibold">
                Review source-backed obligations
              </p>
            </div>
            <span className="w-fit rounded-full bg-warning/15 px-3 py-1 text-xs font-medium text-warning-foreground">
              2 require attention
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {[
              {
                status: "Confirmed",
                tone: "bg-success/12 text-success",
                title: "Evidence of current tax compliance",
                source: "Tender document · cited page and clause",
              },
              {
                status: "Needs evidence",
                tone: "bg-warning/15 text-warning-foreground",
                title: "Demonstrate comparable project experience",
                source: "Evaluation criteria · cited page and clause",
              },
              {
                status: "Review",
                tone: "bg-info/10 text-info",
                title: "Provide signed form of tender",
                source: "Submission instructions · cited page and clause",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.source}
                  </p>
                </div>
                <span
                  className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${item.tone}`}
                >
                  {item.status}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-start gap-3 rounded-lg border border-primary/20 bg-accent/55 p-4">
            <BadgeCheck
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-primary"
            />
            <div>
              <p className="text-sm font-semibold">
                Decision trace remains visible
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Suggested items do not become authoritative until the assigned
                reviewer confirms them.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <PublicShell>
      <PublicMeta
        title="Valo"
        description="Evidence-led tender controls for Nigerian public and regulated-market bids, with exact citations, deterministic checks and named human review."
        path="/"
      />

      <section className="border-b border-border">
        <div className="content-shell grid gap-12 py-16 sm:py-20 lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:py-24">
          <div className="max-w-2xl">
            <p className="inline-flex rounded-full border border-primary/20 bg-accent/55 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              Evidence-led tender operations
            </p>
            <h1 className="mt-6 max-w-xl text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.045em] sm:text-5xl lg:text-[3.6rem]">
              Build a tender submission your team can defend.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              Valo helps bid teams turn complex tender documents into cited
              requirements, evidence-backed actions, deterministic checks and
              named approvals—without pretending AI is the final authority.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/contact">
                  Request a walkthrough
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/product">Explore the product</Link>
              </Button>
            </div>
            <p className="mt-5 max-w-lg text-xs leading-5 text-muted-foreground">
              Valo supports a reviewed process. It does not guarantee award,
              evaluator behaviour or acceptance of a package, and it does not
              submit bids to government portals.
            </p>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section
        aria-label="Control principles"
        className="border-b border-border bg-card"
      >
        <div className="content-shell grid grid-cols-2 gap-px py-6 sm:grid-cols-4">
          {trustPoints.map((point) => (
            <div
              key={point}
              className="flex items-center gap-2 px-2 py-2 text-sm font-medium sm:justify-center"
            >
              <Check
                aria-hidden="true"
                className="size-4 shrink-0 text-success"
              />
              {point}
            </div>
          ))}
        </div>
      </section>

      <section className="content-shell py-16 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">
              The operating problem
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Tender risk hides in handoffs, not just documents.
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              [
                "Requirements disappear",
                "Obligations are copied into scattered sheets without reliable source links or ownership.",
              ],
              [
                "Evidence expires quietly",
                "Teams discover missing or stale certificates after the response has already taken shape.",
              ],
              [
                "Commercial checks drift",
                "Manual BOQ work makes it hard to distinguish a calculation error from a pricing decision.",
              ],
              [
                "Approval becomes a message thread",
                "Critical decisions lose context, named accountability and a defensible audit trail.",
              ],
            ].map(([title, body]) => (
              <article
                key={title}
                className="rounded-lg border border-border bg-card p-5"
              >
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="content-shell py-16 sm:py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">
              How Valo works
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              One controlled path from intake to release.
            </h2>
          </div>
          <ol className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {workflow.map((step) => (
              <li
                key={step.number}
                className="rounded-lg border border-border p-5"
              >
                <span className="font-mono text-xs font-semibold text-primary">
                  {step.number}
                </span>
                <h3 className="mt-5 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
          <Button asChild variant="outline" className="mt-8">
            <Link href="/how-it-works">
              See the complete workflow
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>

      <section className="content-shell py-16 sm:py-20">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">
            Core capabilities
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            Designed around the work reviewers must prove.
          </h2>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {capabilities.map((capability) => (
            <article
              key={capability.title}
              className="rounded-lg border border-border bg-card p-6"
            >
              <capability.icon
                aria-hidden="true"
                className="size-5 text-primary"
              />
              <h3 className="mt-5 font-semibold">{capability.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {capability.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-[#0d1b2f] text-white">
        <div className="content-shell grid gap-10 py-16 sm:py-20 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <LockKeyhole aria-hidden="true" className="size-6 text-[#74d6c4]" />
            <h2 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Security is part of the workflow, not a footer claim.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300">
              Tender material is treated as hostile and sensitive input.
              Storage, model processing and release actions are designed to fail
              closed when required controls are unavailable.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              "Organisation and partner isolation",
              "No document-driven tool execution",
              "Append-only audit provenance",
              "Named review and sign-off",
              "No shared-model training on client files",
              "Explicit uncertainty and source links",
            ].map((item) => (
              <div
                key={item}
                className="flex items-start gap-3 border border-slate-700 p-4"
              >
                <Check
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-[#74d6c4]"
                />
                <span className="text-sm leading-6 text-slate-200">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="content-shell py-16 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
          <div>
            <MessageSquareText
              aria-hidden="true"
              className="size-6 text-primary"
            />
            <h2 className="mt-5 text-3xl font-semibold tracking-[-0.035em]">
              Questions teams ask first
            </h2>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {[
              [
                "Does Valo decide whether a bid is compliant?",
                "No. Valo records and checks the process, while authorised people remain responsible for conclusions, approvals and submission decisions.",
              ],
              [
                "Does Valo write pricing or financial strategy?",
                "No. It can verify arithmetic and formatting on client-supplied figures, but it does not invent rates or recommend pricing strategy.",
              ],
              [
                "Can AI-generated claims enter a package automatically?",
                "No. Claims must be grounded in verified evidence and remain subject to named human review.",
              ],
              [
                "Does Valo submit bids for clients?",
                "No. Controlled exports support the team responsible for submission; Valo does not connect to or automate government-portal submission.",
              ],
            ].map(([question, answer]) => (
              <details key={question} className="group py-5">
                <summary className="cursor-pointer list-none pr-8 text-base font-semibold marker:hidden focus-visible:outline-none">
                  {question}
                </summary>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-accent/45">
        <div className="content-shell flex flex-col gap-6 py-14 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">
              See whether Valo fits your review process.
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Walk through a controlled pursuit workflow without sending tender
              files through a public form.
            </p>
          </div>
          <Button asChild size="lg" className="shrink-0">
            <Link href="/contact">
              Request a walkthrough
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>
    </PublicShell>
  );
}
