import { ArrowDown, Check, FileSearch, UserRoundCheck } from "lucide-react";
import { LandingSections } from "@/components/public/landing-sections";
import { PublicMeta } from "@/components/public/public-meta";
import { BidAutopsyCta } from "@/components/public/public-primary-cta";
import { PublicShell } from "@/components/public/public-shell";

const sampleFindings = [
  {
    title: "Signed declaration is absent",
    source: "Submission instructions / clause 7.1",
    label: "Release blocker",
    tone: "border-destructive/35 bg-destructive/10 text-destructive",
  },
  {
    title: "Certificate period is incomplete",
    source: "Eligibility criteria / clause 4.2",
    label: "Compliance gap",
    tone: "border-warning/45 bg-warning/10 text-warning-foreground",
  },
  {
    title: "Method statement misses one scored criterion",
    source: "Technical evaluation / criterion T-05",
    label: "Scoring risk",
    tone: "border-info/35 bg-info/10 text-info",
  },
] as const;

function HeroReviewPreview() {
  return (
    <figure
      className="border border-border bg-card shadow-md"
      aria-label="Representative Bid Autopsy defect register"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Bid Autopsy / sample
          </p>
          <p className="mt-1 text-sm font-semibold">
            Pre-submission defect register
          </p>
        </div>
        <span className="inline-flex items-center gap-2 border border-border px-2.5 py-1.5 text-xs text-muted-foreground">
          <UserRoundCheck aria-hidden="true" className="size-4 text-primary" />
          Reviewer assigned
        </span>
      </div>
      <div className="p-4 sm:p-5">
        <div className="grid grid-cols-3 border border-border bg-muted/40 text-center">
          <div className="p-3">
            <p className="text-xl font-semibold">42</p>
            <p className="mt-1 text-xs text-muted-foreground">Requirements</p>
          </div>
          <div className="border-x border-border p-3">
            <p className="text-xl font-semibold">3</p>
            <p className="mt-1 text-xs text-muted-foreground">Open findings</p>
          </div>
          <div className="p-3">
            <p className="text-xl font-semibold">1</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Release blocker
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {sampleFindings.map((finding) => (
            <article key={finding.title} className="border border-border p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">{finding.title}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs leading-5 text-muted-foreground">
                    <FileSearch
                      aria-hidden="true"
                      className="size-3.5 shrink-0"
                    />
                    {finding.source}
                  </p>
                </div>
                <span
                  className={`w-fit shrink-0 border px-2 py-1 text-xs font-semibold ${finding.tone}`}
                >
                  {finding.label}
                </span>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-4 flex items-start gap-3 border border-primary/20 bg-accent/55 p-4">
          <Check
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-primary"
          />
          <p className="text-xs leading-5 text-muted-foreground">
            Each finding retains its source, evidence state, owner, action and
            human-review history.
          </p>
        </div>
      </div>
      <figcaption className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
        Representative Valo output using fictional tender data.
      </figcaption>
    </figure>
  );
}

export default function LandingPage() {
  return (
    <PublicShell>
      <PublicMeta
        title="Bid Autopsy for Nigerian Tenders"
        description="Find compliance gaps, evidence gaps, BOQ inconsistencies and responsiveness risks before submission with a human-verified Valo Bid Autopsy."
        path="/"
      />

      <section className="relative border-b border-border">
        <div className="landing-hero-grid content-shell grid gap-12 py-10 sm:py-18 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-16 lg:py-24">
          <div className="landing-hero-copy max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              Tender compliance review for Nigerian bid teams
            </p>
            <h1 className="mt-5 max-w-2xl text-balance text-4xl font-semibold leading-[1.06] tracking-[-0.045em] sm:text-5xl lg:text-[3.75rem]">
              Find the defects before submission.
            </h1>
            <p className="landing-hero-summary mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              Valo helps Nigerian public-sector, oil-and-gas and donor-funded
              bid teams find controllable defects before the evaluator does.
            </p>
            <p className="landing-hero-secondary mt-4 max-w-xl text-base leading-7 text-foreground/90">
              Designed for AI-assisted, human-verified review, Valo links
              requirements to sources, checks evidence and client-supplied BOQ
              arithmetic, red-teams the package and records a named reviewer.
            </p>
            <div className="landing-hero-actions mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <BidAutopsyCta />
              <a
                href="#what-we-check"
                className="inline-flex min-h-11 items-center gap-2 px-1 text-sm font-semibold text-primary underline-offset-4 hover:underline"
              >
                See What the Autopsy Checks
                <ArrowDown aria-hidden="true" className="size-4" />
              </a>
            </div>
            <p className="landing-hero-trust mt-5 max-w-xl text-xs leading-5 text-muted-foreground">
              Valo strengthens the review process; it does not guarantee an
              award or evaluator acceptance. Model-assisted steps operate only
              where provider, privacy and evaluation gates are approved; human
              review remains authoritative.
            </p>
          </div>
          <div className="landing-hero-preview">
            <HeroReviewPreview />
          </div>
        </div>
      </section>

      <LandingSections />
    </PublicShell>
  );
}
