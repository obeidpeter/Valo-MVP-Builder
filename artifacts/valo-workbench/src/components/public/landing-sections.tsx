import {
  BadgeCheck,
  Calculator,
  Check,
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
      <section
        className="border-y border-border bg-card"
        aria-label="Operating boundaries"
      >
        <div className="content-shell grid grid-cols-2 divide-x divide-y divide-border py-1 sm:grid-cols-4 sm:divide-y-0">
          {[
            "No award promises",
            "Named human review",
            "Client-supplied pricing",
            "Source-linked findings",
          ].map((item) => (
            <p
              key={item}
              className="flex min-h-16 items-center gap-2 px-3 text-sm font-medium sm:justify-center"
            >
              <Check
                aria-hidden="true"
                className="size-4 shrink-0 text-success"
              />
              {item}
            </p>
          ))}
        </div>
      </section>

      <section className="content-shell py-16 sm:py-20 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              Survive the compliance gate
            </p>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              A capable bid can be excluded before merit is considered.
            </h2>
            <p className="mt-5 text-base leading-7 text-muted-foreground">
              Valo focuses on preventable, controllable defects: the missing
              record, unanswered instruction or inconsistency an evaluator can
              point to in the published rules.
            </p>
          </div>
          <ul className="grid border-t border-border sm:grid-cols-2">
            {complianceDefects.map((item, index) => (
              <li
                key={item}
                className={`flex min-h-20 items-start gap-3 border-b border-border py-5 text-sm leading-6 ${
                  index % 2 === 0 ? "sm:pr-6" : "sm:border-l sm:pl-6"
                }`}
              >
                <span
                  className="mt-1.5 size-2 shrink-0 bg-warning"
                  aria-hidden="true"
                />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id="what-we-check"
        className="scroll-mt-20 border-y border-border bg-card"
      >
        <div className="content-shell py-16 sm:py-20 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
                The Bid Autopsy
              </p>
              <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
                A concrete review record—not a generic proposal critique.
              </h2>
              <p className="mt-5 text-base leading-7 text-muted-foreground">
                The agreed report shows what was checked, where each requirement
                came from, what evidence was found, what remains exposed and
                what to do next. Scope and limitations stay visible.
              </p>
              <BidAutopsyCta className="mt-8" />
            </div>
            <div className="grid border-t border-border sm:grid-cols-2">
              {autopsyDeliverables.map(([title, body], index) => (
                <article
                  key={title}
                  className={`border-b border-border py-5 ${
                    index % 2 === 0 ? "sm:pr-6" : "sm:border-l sm:pl-6"
                  }`}
                >
                  <h3 className="font-semibold">{title}</h3>
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
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            From first contact to a review your team can act on.
          </h2>
        </div>
        <ol className="mt-10 grid border-y border-border md:grid-cols-2 xl:grid-cols-4">
          {process.map((step, index) => (
            <li
              key={step.number}
              className={`p-6 ${index > 0 ? "border-t border-border md:border-l" : ""} ${
                index === 2 ? "md:border-l-0 xl:border-l" : ""
              } ${index > 1 ? "xl:border-t-0" : ""}`}
            >
              <span className="font-mono text-xs font-semibold text-primary">
                {step.number}
              </span>
              <h3 className="mt-6 font-semibold">{step.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-border bg-[#0d1b2f]">
        <div className="content-shell py-16 sm:py-20 lg:py-24">
          <div className="mb-10 max-w-3xl text-white">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#74d6c4]">
              Show the work
            </p>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Follow the line from tender clause to remediation.
            </h2>
            <p className="mt-5 text-base leading-7 text-slate-300">
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
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              From diagnosis to submission
            </p>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Start with the diagnosis. Continue where Valo can add measurable
              value.
            </h2>
            <p className="mt-5 text-sm leading-6 text-muted-foreground">
              Service availability, scope and commercial terms are confirmed for
              each engagement. The Bid Autopsy remains the first conversation.
            </p>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {services.map((service, index) => (
              <article
                key={service.title}
                className="grid gap-2 py-5 sm:grid-cols-[2rem_12rem_1fr] sm:gap-4"
              >
                <span className="font-mono text-xs font-semibold text-primary">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="font-semibold">{service.title}</h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  {service.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="content-shell py-16 sm:py-20 lg:py-24">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              Why Valo
            </p>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Built around the evidence a decision should withstand.
            </h2>
          </div>
          <div className="mt-10 grid border-y border-border md:grid-cols-2 xl:grid-cols-3">
            {differentiators.map(([Icon, title, body], index) => (
              <article
                key={title}
                className={`p-6 ${index > 0 ? "border-t border-border md:border-l" : ""} ${
                  index % 2 === 0 && index > 0 ? "md:border-l-0" : ""
                } ${index > 1 ? "xl:border-t-0" : ""} ${
                  index === 3 ? "xl:border-l-0" : ""
                }`}
              >
                <Icon aria-hidden="true" className="size-5 text-primary" />
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
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
          <div>
            <UsersRound aria-hidden="true" className="size-6 text-primary" />
            <h2 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              For teams that cannot treat compliance as a final-day check.
            </h2>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {audiences.map(([title, body]) => (
              <article
                key={title}
                className="grid gap-2 py-5 sm:grid-cols-[12rem_1fr] sm:gap-6"
              >
                <h3 className="font-semibold">{title}</h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  {body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="trust"
        className="scroll-mt-20 border-y border-border bg-[#0d1b2f] text-white"
      >
        <div className="content-shell grid gap-12 py-16 sm:py-20 lg:grid-cols-[0.75fr_1.25fr] lg:py-24">
          <div>
            <ShieldCheck aria-hidden="true" className="size-7 text-[#74d6c4]" />
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.14em] text-[#74d6c4]">
              Integrity and data trust
            </p>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Commercial trust begins with clear boundaries.
            </h2>
            <p className="mt-5 text-base leading-7 text-slate-300">
              AI-assisted features operate only where the relevant provider and
              environment are approved. They do not replace human approval or
              turn an unsupported claim into evidence.
            </p>
            <BidAutopsyCta className="mt-8 bg-[#74d6c4] text-[#0d1b2f] [border-color:#74d6c4]" />
          </div>
          <ul className="grid border-t border-slate-700 sm:grid-cols-2">
            {integrityPrinciples.map((item, index) => (
              <li
                key={item}
                className={`flex items-start gap-3 border-b border-slate-700 py-5 text-sm leading-6 text-slate-200 ${
                  index % 2 === 0 ? "sm:pr-6" : "sm:border-l sm:pl-6"
                }`}
              >
                <BadgeCheck
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-[#74d6c4]"
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
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Questions before the first review.
            </h2>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {faqs.map(([question, answer]) => (
              <details key={question} className="group py-5">
                <summary className="min-h-11 cursor-pointer rounded-sm pr-8 text-base font-semibold leading-7 marker:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">
                  {question}
                </summary>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-accent/55">
        <div className="content-shell flex flex-col gap-7 py-14 sm:py-16 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <ClipboardCheck
              aria-hidden="true"
              className="size-6 text-primary"
            />
            <h2 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.035em]">
              Give the package a review trail before it faces an evaluator.
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Start with ordinary business contact details. No tender documents
              or sensitive commercial information are requested here.
            </p>
          </div>
          <BidAutopsyCta className="shrink-0" />
        </div>
      </section>
    </>
  );
}
