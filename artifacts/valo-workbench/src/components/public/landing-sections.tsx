import {
  BadgeCheck,
  Calculator,
  Check,
  ChevronDown,
  ClipboardCheck,
  FileSearch,
  Fingerprint,
  Landmark,
  ListChecks,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { BidAutopsyCta } from "@/components/public/public-primary-cta";
import { BidAutopsySample } from "@/components/public/bid-autopsy-sample";

const complianceDefects = [
  "Missing or expired compliance documents",
  "Omitted signatures, declarations or schedules",
  "Mandatory requirements left unanswered",
  "Bill of quantities (BOQ) arithmetic inconsistencies",
  "Page-limit or formatting failures",
  "Incorrect package order or labelling",
  "Evidence that does not support the stated claim",
  "Technical responses that miss the published criterion",
] as const;

const autopsyDeliverables = [
  ["Requirement matrix", "Requirements linked back to their tender source."],
  ["Defect register", "A controlled list of gaps, inconsistencies and risks."],
  [
    "Severity classification",
    "Clear separation of compliance and scoring exposure.",
  ],
  ["Evidence review", "Missing, expired or insufficient support made visible."],
  ["BOQ findings", "Deterministic checks on client-supplied figures."],
  ["Responsiveness review", "Whether answers address the published criteria."],
  [
    "Remediation plan",
    "Priorities, recommended actions, ownership and status.",
  ],
  [
    "Human review record",
    "A named reviewer and explicit scope and limitations.",
  ],
] as const;

const process = [
  {
    number: "01",
    title: "Establish scope and controls",
    body: "Use the public form only for business contact details. Tender material enters later through the approved process, after the relevant privacy, conflict and engagement gates.",
  },
  {
    number: "02",
    title: "Extract and verify requirements",
    body: "Valo structures obligations with page and clause references. Suggested items remain subject to named human confirmation.",
  },
  {
    number: "03",
    title: "Test evidence, figures and response",
    body: "Deterministic checks and human-led review examine evidence, client-supplied BOQ arithmetic, responsiveness and package controls.",
  },
  {
    number: "04",
    title: "Receive findings and priorities",
    body: "The customer receives transparent findings, their sources, severity and recommended next actions within the agreed scope.",
  },
] as const;

const services = [
  {
    title: "Assisted Bid Production",
    body: "Controlled support to resolve identified requirements, evidence and response gaps while client approval remains explicit.",
  },
  {
    title: "Prequalification Packs",
    body: "Reusable, reviewed qualification material organised for the requirements it can genuinely support.",
  },
  {
    title: "Certificate Vault",
    body: "Organisation-scoped evidence records with validity and renewal context for authorised teams.",
  },
  {
    title: "Compliance Monitoring",
    body: "Visibility of evidence readiness and renewal needs where the engagement and product controls support it.",
  },
  {
    title: "Consultancy-Partner Support",
    body: "Independent quality review and controlled client workspaces for authorised bid consultancies.",
  },
] as const;

const differentiators = [
  [
    Landmark,
    "Nigerian tender focus",
    "Designed around public, energy-sector and donor-funded procurement workflows.",
  ],
  [
    FileSearch,
    "Source-cited requirements",
    "A reviewer can trace a requirement back to the clause that created it.",
  ],
  [
    Fingerprint,
    "Evidence-linked work",
    "Claims and actions remain connected to the records intended to support them.",
  ],
  [
    Calculator,
    "Deterministic checks",
    "Arithmetic is checked as arithmetic—not delegated to a language model.",
  ],
  [
    UserRoundCheck,
    "Human accountability",
    "Client-visible conclusions and release decisions remain attributable to people.",
  ],
  [
    ListChecks,
    "Transparent findings",
    "Severity, status, source, owner and remediation remain visible in the review trail.",
  ],
] as const;

const audiences = [
  [
    "Federal contractors",
    "Check eligibility, mandatory forms, evidence and package controls before a public-sector submission.",
  ],
  [
    "NipeX and NCDMB suppliers",
    "Trace energy-sector tender obligations and qualification evidence without treating platform registration as proof of responsiveness.",
  ],
  [
    "Donor-funded bidders and NGOs",
    "Map technical responses and compliance evidence to the published evaluation and submission rules.",
  ],
  [
    "Bid and commercial teams",
    "Coordinate requirements, owners, evidence and client-supplied figures on one review trail.",
  ],
  [
    "Consultancy partners",
    "Add an independent quality layer while preserving client ownership and clear role boundaries.",
  ],
] as const;

const integrityPrinciples = [
  "No award promises or evaluator-influence claims",
  "No fabricated credentials, experience or supporting evidence",
  "No facilitation, relationship brokering or portal submission",
  "Commercial figures and pricing decisions remain client-supplied",
  "Tender workspace access is organisation-scoped",
  "Client data is not approved for shared-model training",
  "Same-tender conflicts are subject to recorded conflict controls",
  "Client-visible findings receive named human review",
] as const;

const faqs = [
  [
    "What is a Bid Autopsy?",
    "It is a structured review of a tender package against its published requirements. The agreed output can include a source-cited requirement matrix, defect register, evidence and BOQ findings, severity and a prioritised remediation plan.",
  ],
  [
    "Does Valo guarantee an award?",
    "No. Valo helps a team identify and address controllable defects. It cannot guarantee an evaluator’s decision, acceptance of a package or contract award.",
  ],
  [
    "Can Valo review a live bid?",
    "Yes, where scope, timing, conflicts and an approved document-sharing process can be agreed. The public request form does not accept tender documents.",
  ],
  [
    "Can Valo review a previously unsuccessful bid?",
    "Yes. A retrospective review can compare the submitted package, available feedback and published criteria, while distinguishing evidence from inference.",
  ],
  [
    "Must financial pages be shared?",
    "Not for the first contact. If BOQ verification is in scope, the minimum relevant commercial pages can be handled later through the approved document-sharing process. Valo does not determine pricing.",
  ],
  [
    "What documents are required?",
    "That depends on the agreed review. Typical later-stage inputs may include the tender, clarifications, the draft or submitted response and selected supporting evidence. Do not send them through the public form.",
  ],
  [
    "Does Valo create commercial pricing?",
    "No. Valo can check arithmetic and consistency in client-supplied figures, but rates, assumptions and commercial strategy remain the client’s responsibility.",
  ],
  [
    "How is information protected?",
    "The first-contact form is deliberately limited to ordinary business details. Tender material is handled only after the appropriate engagement and approved document-sharing gates; access and provider readiness are checked rather than assumed.",
  ],
  [
    "How long does the process take?",
    "Timing is confirmed only after Valo understands the scope, volume, deadline and review depth. There is no unqualified public turnaround promise.",
  ],
  [
    "What happens after the Autopsy?",
    "Your team receives the agreed findings and priorities, then decides what to remediate. Any further Valo support is separately scoped and keeps client approval explicit.",
  ],
  [
    "Can Valo help correct the identified problems?",
    "Where capability, timing and scope allow, Valo can support remediation and assisted bid production. The diagnosis remains useful even when the client completes the corrections independently.",
  ],
] as const;

export function LandingSections() {
  return (
    <>
      <section className="relative z-10" aria-label="Operating boundaries">
        <div className="content-shell sm:-mt-7">
          <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-md sm:grid-cols-4 sm:divide-y-0">
            {[
              "No award promises",
              "Named human review",
              "Client-supplied pricing",
              "Source-linked findings",
            ].map((item) => (
              <p
                key={item}
                className="flex min-h-18 items-center gap-3 px-4 text-sm font-medium sm:justify-center"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success/10">
                  <Check aria-hidden="true" className="size-4 text-success" />
                </span>
                {item}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden py-16 sm:py-20 lg:py-24">
        <div
          aria-hidden="true"
          className="absolute -right-32 top-12 size-80 rounded-full bg-warning/5 blur-3xl"
        />
        <div className="content-shell relative grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              Survive the compliance gate
            </p>
            <h2 className="public-display mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              A capable bid can be excluded before merit is considered.
            </h2>
            <p className="mt-5 text-base leading-7 text-muted-foreground">
              Valo focuses on preventable, controllable defects: the missing
              record, unanswered instruction or inconsistency an evaluator can
              point to in the published rules.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {complianceDefects.map((item) => (
              <li
                key={item}
                className="flex min-h-24 items-start gap-4 rounded-xl border border-border bg-card p-5 text-sm leading-6 shadow-xs"
              >
                <span
                  className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-warning/12"
                  aria-hidden="true"
                >
                  <span className="size-2 rounded-full bg-warning" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id="what-we-check"
        className="scroll-mt-20 border-y border-border bg-accent/35"
      >
        <div className="content-shell py-16 sm:py-20 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className="inline-flex rounded-full border border-primary/20 bg-card/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                The Bid Autopsy
              </p>
              <h2 className="public-display mt-5 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
                A concrete review record—not a generic proposal critique.
              </h2>
              <p className="mt-5 text-base leading-7 text-muted-foreground">
                The agreed report shows what was checked, where each requirement
                came from, what evidence was found, what remains exposed and
                what to do next. Scope and limitations stay visible.
              </p>
              <BidAutopsyCta className="mt-8 rounded-lg shadow-sm" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {autopsyDeliverables.map(([title, body]) => (
                <article
                  key={title}
                  className="rounded-xl border border-primary/15 bg-card/85 p-5 shadow-xs"
                >
                  <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Check aria-hidden="true" className="size-4" />
                  </span>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="content-shell scroll-mt-20 py-16 sm:py-20 lg:py-24"
      >
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
            How it works
          </p>
          <h2 className="public-display mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            From first contact to a review your team can act on.
          </h2>
        </div>
        <ol className="relative mt-12 grid gap-4 before:absolute before:left-[12.5%] before:right-[12.5%] before:top-5 before:hidden before:h-px before:bg-primary/25 xl:grid-cols-4 xl:before:block">
          {process.map((step) => (
            <li
              key={step.number}
              className="relative rounded-xl border border-border bg-card p-6 shadow-xs"
            >
              <span className="relative z-10 flex size-10 items-center justify-center rounded-full border border-primary/25 bg-background font-mono text-xs font-semibold text-primary shadow-xs">
                {step.number}
              </span>
              <h3 className="mt-5 font-semibold">{step.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="relative isolate overflow-hidden border-y border-sidebar-border bg-sidebar">
        <div
          aria-hidden="true"
          className="public-dark-glow pointer-events-none absolute inset-0"
        />
        <div
          aria-hidden="true"
          className="public-document-grid pointer-events-none absolute inset-0 opacity-20"
        />
        <div className="content-shell relative py-16 sm:py-20 lg:py-24">
          <div className="mb-10 max-w-3xl text-sidebar-foreground">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-sidebar-primary">
              Show the work
            </p>
            <h2 className="public-display mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Follow the line from tender clause to remediation.
            </h2>
            <p className="mt-5 text-base leading-7 text-sidebar-foreground/70">
              Valo separates source, requirement, evidence, finding and action
              so a reviewer can challenge the conclusion without losing its
              basis.
            </p>
          </div>
          <BidAutopsySample />
        </div>
      </section>

      <section
        id="services"
        className="content-shell scroll-mt-20 py-16 sm:py-20 lg:py-24"
      >
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              From diagnosis to submission
            </p>
            <h2 className="public-display mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Start with the diagnosis. Continue where Valo can add measurable
              value.
            </h2>
            <p className="mt-5 text-sm leading-6 text-muted-foreground">
              Service availability, scope and commercial terms are confirmed for
              each engagement. The Bid Autopsy remains the first conversation.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {services.map((service, index) => (
              <article
                key={service.title}
                className="rounded-xl border border-border bg-card p-5 shadow-xs"
              >
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 font-mono text-xs font-semibold text-primary">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-5 font-semibold">{service.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {service.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-accent/20">
        <div className="content-shell py-16 sm:py-20 lg:py-24">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              Why Valo
            </p>
            <h2 className="public-display mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Built around the evidence a decision should withstand.
            </h2>
          </div>
          <div className="mt-10 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {differentiators.map(([Icon, title, body]) => (
              <article
                key={title}
                className="rounded-xl border border-primary/10 bg-card p-6 shadow-xs"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <h3 className="mt-5 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="content-shell py-16 sm:py-20 lg:py-24">
        <div className="max-w-3xl">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UsersRound aria-hidden="true" className="size-6" />
          </span>
          <h2 className="public-display mt-5 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            For teams that cannot treat compliance as a final-day check.
          </h2>
        </div>
        <div className="mt-10 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {audiences.map(([title, body]) => (
            <article
              key={title}
              className="rounded-xl border border-border bg-card p-5 shadow-xs"
            >
              <h3 className="font-semibold text-primary">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section
        id="trust"
        className="relative isolate scroll-mt-20 overflow-hidden border-y border-sidebar-border bg-sidebar text-sidebar-foreground"
      >
        <div
          aria-hidden="true"
          className="public-dark-glow pointer-events-none absolute inset-0"
        />
        <span
          aria-hidden="true"
          className="public-display pointer-events-none absolute -bottom-32 -left-8 text-[24rem] leading-none text-sidebar-primary/5"
        >
          V
        </span>
        <div className="content-shell relative grid gap-12 py-16 sm:py-20 lg:grid-cols-[0.75fr_1.25fr] lg:py-24">
          <div>
            <span className="flex size-12 items-center justify-center rounded-xl border border-sidebar-primary/25 bg-sidebar-accent text-sidebar-primary">
              <ShieldCheck aria-hidden="true" className="size-7" />
            </span>
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.14em] text-sidebar-primary">
              Integrity and data trust
            </p>
            <h2 className="public-display mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Commercial trust begins with clear boundaries.
            </h2>
            <p className="mt-5 text-base leading-7 text-sidebar-foreground/70">
              AI-assisted features operate only where the relevant provider and
              environment are approved. They do not replace human approval or
              turn an unsupported claim into evidence.
            </p>
            <BidAutopsyCta className="mt-8 rounded-lg border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground shadow-md" />
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {integrityPrinciples.map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/70 p-5 text-sm leading-6 text-sidebar-foreground/80"
              >
                <BadgeCheck
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-sidebar-primary"
                />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id="faq"
        className="content-shell scroll-mt-20 py-16 sm:py-20 lg:py-24"
      >
        <div className="grid gap-10 lg:grid-cols-[0.6fr_1.4fr] lg:gap-20">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              FAQ
            </p>
            <h2 className="public-display mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Questions before the first review.
            </h2>
          </div>
          <div className="space-y-3">
            {faqs.map(([question, answer]) => (
              <details
                key={question}
                className="group rounded-xl border border-border bg-card px-5 shadow-xs open:border-primary/20 open:shadow-sm"
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-1.5 text-base font-semibold leading-7 marker:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 [&::-webkit-details-marker]:hidden">
                  <span>{question}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-5 shrink-0 text-primary transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="max-w-3xl pb-5 text-sm leading-6 text-muted-foreground">
                  {answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border py-12 sm:py-16">
        <div className="content-shell">
          <div className="relative isolate flex flex-col gap-8 overflow-hidden rounded-2xl border border-sidebar-border bg-sidebar px-6 py-10 text-sidebar-foreground shadow-md sm:px-10 sm:py-12 lg:flex-row lg:items-center lg:justify-between">
            <div
              aria-hidden="true"
              className="public-dark-glow pointer-events-none absolute inset-0"
            />
            <div className="relative max-w-3xl">
              <span className="flex size-11 items-center justify-center rounded-xl border border-sidebar-primary/25 bg-sidebar-accent text-sidebar-primary">
                <ClipboardCheck aria-hidden="true" className="size-6" />
              </span>
              <h2 className="public-display mt-5 text-balance text-3xl font-semibold tracking-[-0.035em]">
                Give the package a review trail before it faces an evaluator.
              </h2>
              <p className="mt-3 text-sm leading-6 text-sidebar-foreground/70">
                Start with ordinary business contact details. No tender
                documents or sensitive commercial information are requested
                here.
              </p>
            </div>
            <BidAutopsyCta className="relative shrink-0 rounded-lg border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground shadow-md" />
          </div>
        </div>
      </section>
    </>
  );
}
