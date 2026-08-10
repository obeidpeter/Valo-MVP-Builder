import {
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
      <nav
        aria-label="Landing page sections"
        className="sticky top-16 z-30 border-b border-border bg-background/88 backdrop-blur-xl"
      >
        <div className="content-shell overflow-x-auto">
          <ul className="flex min-w-max items-center gap-1 py-3">
            {[
              ["#what-we-check", "What we check"],
              ["#how-it-works", "Process"],
              ["#services", "Services"],
              ["#trust", "Trust"],
              ["#faq", "FAQ"],
            ].map(([href, label]) => (
              <li key={href}>
                <a
                  href={href}
                  className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <section className="relative z-10" aria-label="Operating boundaries">
        <div className="border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
          <div className="content-shell grid grid-cols-2 divide-x divide-y divide-sidebar-border sm:grid-cols-4 sm:divide-y-0">
            {[
              "No award promises",
              "Named human review",
              "Client-supplied pricing",
              "Source-linked findings",
            ].map((item) => (
              <p
                key={item}
                className="flex min-h-18 items-center gap-3 px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/70 sm:justify-center"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-sidebar-primary/25 bg-sidebar-accent">
                  <Check
                    aria-hidden="true"
                    className="size-4 text-sidebar-primary"
                  />
                </span>
                {item}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden py-20 sm:py-24 lg:py-32">
        <div
          aria-hidden="true"
          className="absolute -right-32 top-12 size-80 rounded-full bg-sidebar-primary/8 blur-3xl"
        />
        <div className="content-shell relative grid gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-24">
          <div className="lg:sticky lg:top-36 lg:self-start">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              Survive the compliance gate
            </p>
            <h2 className="public-display mt-5 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
              A capable bid can be excluded before merit is considered.
            </h2>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground">
              Valo focuses on preventable, controllable defects: the missing
              record, unanswered instruction or inconsistency an evaluator can
              point to in the published rules.
            </p>
          </div>
          <ul className="border-t border-border">
            {complianceDefects.map((item, index) => (
              <li
                key={item}
                className="grid min-h-20 grid-cols-[2.5rem_1fr_auto] items-center gap-4 border-b border-border py-5 text-sm leading-6"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="font-medium text-foreground/90">{item}</span>
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-warning"
                />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id="what-we-check"
        className="scroll-mt-20 border-y border-border bg-card/35"
      >
        <div className="content-shell py-20 sm:py-24 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
            <div className="lg:sticky lg:top-36 lg:self-start">
              <p className="inline-flex rounded-full border border-primary/20 bg-accent/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                The Bid Autopsy
              </p>
              <h2 className="public-display mt-6 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
                A concrete review record—not a generic proposal critique.
              </h2>
              <p className="mt-5 text-base leading-7 text-muted-foreground">
                The agreed report shows what was checked, where each requirement
                came from, what evidence was found, what remains exposed and
                what to do next. Scope and limitations stay visible.
              </p>
              <BidAutopsyCta className="mt-8 rounded-full px-6 shadow-sm" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {autopsyDeliverables.map(([title, body], index) => (
                <article
                  key={title}
                  className="group min-h-52 rounded-3xl border border-primary/15 bg-background/55 p-6 transition-colors hover:border-primary/35 hover:bg-background"
                >
                  <span className="font-mono text-xs font-semibold text-primary/70">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-10 text-xl font-medium tracking-[-0.02em]">
                    {title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
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
        className="content-shell scroll-mt-20 py-20 sm:py-24 lg:py-32"
      >
        <div className="max-w-4xl">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
            How it works
          </p>
          <h2 className="public-display mt-5 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
            From first contact to a review your team can act on.
          </h2>
        </div>
        <ol className="mt-14 grid border-t border-border lg:grid-cols-2">
          {process.map((step) => (
            <li
              key={step.number}
              className="relative border-b border-border py-8 lg:min-h-72 lg:px-8 lg:py-10 lg:odd:border-r"
            >
              <span className="public-display text-5xl font-medium tracking-[-0.06em] text-primary/55">
                {step.number}
              </span>
              <h3 className="mt-8 text-xl font-medium tracking-[-0.02em]">
                {step.title}
              </h3>
              <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
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
        <div className="content-shell relative py-20 sm:py-24 lg:py-32">
          <div className="mb-12 max-w-5xl text-sidebar-foreground">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-sidebar-primary">
              Show the work
            </p>
            <h2 className="public-display mt-5 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
              Follow the line from tender clause to remediation.
            </h2>
            <p className="mt-6 max-w-3xl text-base leading-7 text-sidebar-foreground/70">
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
        className="content-shell scroll-mt-20 py-20 sm:py-24 lg:py-32"
      >
        <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
          <div className="lg:sticky lg:top-36 lg:self-start">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              From diagnosis to submission
            </p>
            <h2 className="public-display mt-5 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
              Start with the diagnosis. Continue where Valo can add measurable
              value.
            </h2>
            <p className="mt-5 text-sm leading-6 text-muted-foreground">
              Service availability, scope and commercial terms are confirmed for
              each engagement. The Bid Autopsy remains the first conversation.
            </p>
          </div>
          <div className="border-t border-border">
            {services.map((service, index) => (
              <article
                key={service.title}
                className="grid gap-4 border-b border-border py-7 sm:grid-cols-[3rem_0.75fr_1.25fr] sm:items-start sm:gap-6"
              >
                <span className="font-mono text-xs font-semibold text-primary/70">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="text-lg font-medium tracking-[-0.02em]">
                  {service.title}
                </h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  {service.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-card/35">
        <div className="content-shell py-20 sm:py-24 lg:py-32">
          <div className="max-w-5xl">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              Why Valo
            </p>
            <h2 className="public-display mt-5 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
              Built around the evidence a decision should withstand.
            </h2>
          </div>
          <div className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {differentiators.map(([Icon, title, body]) => (
              <article
                key={title}
                className="min-h-64 rounded-3xl border border-primary/15 bg-background/55 p-7 transition-colors hover:border-primary/35 hover:bg-background"
              >
                <span className="flex size-11 items-center justify-center rounded-full border border-primary/20 bg-accent/60 text-primary">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <h3 className="mt-10 text-xl font-medium tracking-[-0.02em]">
                  {title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="content-shell py-20 sm:py-24 lg:py-32">
        <div className="max-w-5xl">
          <span className="flex size-11 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
            <UsersRound aria-hidden="true" className="size-6" />
          </span>
          <h2 className="public-display mt-6 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
            For teams that cannot treat compliance as a final-day check.
          </h2>
        </div>
        <div className="mt-14 border-t border-border">
          {audiences.map(([title, body], index) => (
            <article
              key={title}
              className="grid gap-4 border-b border-border py-7 sm:grid-cols-[3rem_0.8fr_1.2fr] sm:items-start sm:gap-6"
            >
              <span className="font-mono text-xs font-semibold text-primary/70">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-lg font-medium tracking-[-0.02em] text-foreground">
                {title}
              </h3>
              <p className="text-sm leading-6 text-muted-foreground">{body}</p>
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
        <div className="content-shell relative grid gap-14 py-20 sm:py-24 lg:grid-cols-[0.82fr_1.18fr] lg:gap-20 lg:py-32">
          <div>
            <span className="flex size-12 items-center justify-center rounded-full border border-sidebar-primary/25 bg-sidebar-accent text-sidebar-primary">
              <ShieldCheck aria-hidden="true" className="size-7" />
            </span>
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.14em] text-sidebar-primary">
              Integrity and data trust
            </p>
            <h2 className="public-display mt-5 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
              Commercial trust begins with clear boundaries.
            </h2>
            <p className="mt-5 text-base leading-7 text-sidebar-foreground/70">
              AI-assisted features operate only where the relevant provider and
              environment are approved. They do not replace human approval or
              turn an unsupported claim into evidence.
            </p>
            <BidAutopsyCta className="mt-8 rounded-full border-sidebar-primary bg-sidebar-primary px-6 text-sidebar-primary-foreground shadow-md" />
          </div>
          <ul className="grid gap-x-8 sm:grid-cols-2">
            {integrityPrinciples.map((item, index) => (
              <li
                key={item}
                className="grid grid-cols-[2rem_1fr] gap-3 border-b border-sidebar-border py-5 text-sm leading-6 text-sidebar-foreground/80"
              >
                <span className="font-mono text-xs text-sidebar-primary/70">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id="faq"
        className="content-shell scroll-mt-20 py-20 sm:py-24 lg:py-32"
      >
        <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-24">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              FAQ
            </p>
            <h2 className="public-display mt-5 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
              Questions before the first review.
            </h2>
          </div>
          <div className="border-t border-border">
            {faqs.map(([question, answer]) => (
              <details
                key={question}
                className="group border-b border-border px-1 open:border-primary/35"
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-3 text-base font-medium leading-7 marker:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 [&::-webkit-details-marker]:hidden">
                  <span>{question}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-5 shrink-0 text-primary transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="max-w-3xl pb-6 pr-10 text-sm leading-6 text-muted-foreground">
                  {answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-sidebar-border bg-sidebar py-8 text-sidebar-foreground sm:py-12">
        <div className="content-shell">
          <div className="relative isolate flex min-h-[28rem] flex-col justify-between gap-12 overflow-hidden rounded-[2rem] border border-sidebar-border bg-sidebar-accent/50 px-6 py-10 sm:px-10 sm:py-12 lg:flex-row lg:items-end">
            <div
              aria-hidden="true"
              className="public-dark-glow pointer-events-none absolute inset-0"
            />
            <div className="relative max-w-5xl">
              <span className="flex size-11 items-center justify-center rounded-full border border-sidebar-primary/25 bg-sidebar text-sidebar-primary">
                <ClipboardCheck aria-hidden="true" className="size-6" />
              </span>
              <h2 className="public-display mt-8 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-6xl lg:text-7xl">
                Give the package a review trail before it faces an evaluator.
              </h2>
              <p className="mt-3 text-sm leading-6 text-sidebar-foreground/70">
                Start with ordinary business contact details. No tender
                documents or sensitive commercial information are requested
                here.
              </p>
            </div>
            <BidAutopsyCta className="relative shrink-0 rounded-full border-sidebar-primary bg-sidebar-primary px-6 text-sidebar-primary-foreground shadow-md" />
          </div>
        </div>
      </section>
    </>
  );
}
