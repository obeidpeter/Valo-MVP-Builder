import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  FileSearch,
  ShieldAlert,
  Calculator,
  BadgeCheck,
  Library,
  FileCheck2,
  ArrowRight,
  Lock,
  Check,
  AlertTriangle,
} from "lucide-react";

const features = [
  {
    icon: FileSearch,
    title: "AI-Assisted Review",
    body: "Extract requirements, map evidence, and surface defects from tender documents — every suggestion stays inert until a named reviewer confirms it.",
  },
  {
    icon: ShieldAlert,
    title: "Deterministic Risk Scoring",
    body: "A transparent, reproducible risk band computed only from confirmed findings. No black boxes, no unconfirmed AI noise driving the score.",
  },
  {
    icon: Calculator,
    title: "BOQ Math Checks",
    body: "Bill-of-quantities arithmetic verified in exact integer kobo — section totals, grand totals, and words-versus-figures with zero float drift.",
  },
  {
    icon: BadgeCheck,
    title: "Certificate Vault",
    body: "Track client certificates with expiry telemetry and a cross-client renewal radar, so nothing lapses in the middle of a live bid.",
  },
  {
    icon: Library,
    title: "SBD Corpus",
    body: "A versioned, firm-wide library of standard bidding documents and annotations — reference material every reviewer works from.",
  },
  {
    icon: FileCheck2,
    title: "Audit-Ready Reports",
    body: "Signed reports with a tamper-evident audit chain and a full project export, so every conclusion is reproducible and defensible.",
  },
];

const proofPoints = [
  { value: "Kobo-exact", label: "Integer arithmetic" },
  { value: "Confirmed-only", label: "Human-gated scoring" },
  { value: "Tamper-evident", label: "Signed audit chain" },
  { value: "Reproducible", label: "Every conclusion" },
];

const lifecycle = [
  { step: "Intake", body: "Ingest tender documents and SBDs." },
  { step: "Review", body: "AI surfaces requirements & defects." },
  { step: "Confirm", body: "A named reviewer gates each finding." },
  { step: "Score", body: "Deterministic risk band computed." },
  { step: "Report", body: "Signed, audit-chained export." },
];

function CrosshairCorners() {
  const base =
    "absolute w-3 h-3 border-primary-foreground/40 pointer-events-none";
  return (
    <>
      <span className={`${base} top-0 left-0 border-t border-l`} />
      <span className={`${base} top-0 right-0 border-t border-r`} />
      <span className={`${base} bottom-0 left-0 border-b border-l`} />
      <span className={`${base} bottom-0 right-0 border-b border-r`} />
    </>
  );
}

function SpecimenPanel() {
  return (
    <div className="relative">
      <CrosshairCorners />
      <div className="m-3 rounded-lg border border-primary-foreground/15 bg-primary-foreground/[0.04] backdrop-blur-sm p-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-primary-foreground/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-[11px] uppercase tracking-widest text-primary-foreground/70">
              Specimen · BID-2026-0417
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-primary-foreground/40">
            Live
          </span>
        </div>

        {/* Risk band */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-primary-foreground/50">
              Risk Band
            </span>
            <span className="font-mono text-[11px] font-semibold text-amber-400 uppercase tracking-widest">
              Elevated
            </span>
          </div>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full ${
                  i <= 2 ? "bg-amber-400/80" : "bg-primary-foreground/15"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Findings */}
        <div className="mt-5 space-y-2">
          {[
            { icon: AlertTriangle, tone: "text-amber-400", text: "Mispriced BOQ line — section 4.2", tag: "Confirmed" },
            { icon: Check, tone: "text-emerald-400", text: "Tax clearance certificate valid", tag: "Verified" },
            { icon: Check, tone: "text-emerald-400", text: "Grand total reconciles to kobo", tag: "Verified" },
          ].map((row) => (
            <div
              key={row.text}
              className="flex items-center gap-3 rounded-md border border-primary-foreground/10 bg-primary-foreground/[0.03] px-3 py-2.5"
            >
              <row.icon className={`w-4 h-4 shrink-0 ${row.tone}`} />
              <span className="text-xs text-primary-foreground/80 flex-1 truncate">
                {row.text}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-widest text-primary-foreground/40">
                {row.tag}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between border-t border-primary-foreground/10 pt-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-primary-foreground/40">
            Reviewer: A. Okafor
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-primary-foreground/40">
            Audit #7F3A···
          </span>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto max-w-6xl w-full px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary text-primary-foreground rounded flex items-center justify-center font-bold text-sm ring-1 ring-primary/20 ring-offset-2 ring-offset-background">
              VW
            </div>
            <div className="leading-none">
              <div className="font-serif font-semibold tracking-tight">Valo Workbench</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1 font-mono">
                Forensic Review
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <a
              href="#capabilities"
              className="hidden sm:inline font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              Capabilities
            </a>
            <a
              href="#lifecycle"
              className="hidden sm:inline font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              Lifecycle
            </a>
            <Button size="sm" asChild data-testid="button-signin-nav">
              <Link href="/sign-in">Sign In</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        {/* Blueprint grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
        {/* Radial fade */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(80% 60% at 12% 0%, hsl(var(--primary-foreground) / 0.12), transparent 60%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl w-full px-6 py-20 md:py-28">
          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-14 lg:gap-10 items-center">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 px-3 py-1 mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-foreground/70" />
                <span className="font-mono text-[11px] uppercase tracking-widest text-primary-foreground/80">
                  Bid &amp; Tender Autopsy Platform
                </span>
              </div>
              <h1 className="font-serif text-4xl md:text-6xl tracking-tight leading-[1.03]">
                Every bid, dissected before it costs you the{" "}
                <span className="italic text-primary-foreground/90 underline decoration-primary-foreground/25 decoration-1 underline-offset-[6px]">
                  contract.
                </span>
              </h1>
              <p className="mt-7 text-lg text-primary-foreground/70 leading-relaxed max-w-xl">
                Valo Workbench pairs AI-assisted document review with deterministic,
                audit-ready checks — so your team catches the fatal defect, the mispriced
                BOQ line, and the expired certificate before submission, not after.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <Button
                  size="lg"
                  asChild
                  className="gap-2 bg-primary-foreground text-primary border-transparent"
                  data-testid="button-signin-hero"
                >
                  <Link href="/sign-in">
                    Sign In to Workbench
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="bg-transparent text-primary-foreground [border-color:hsl(var(--primary-foreground)/0.25)]"
                  data-testid="button-explore"
                >
                  <a href="#capabilities">Explore Capabilities</a>
                </Button>
              </div>
            </div>
            <div className="lg:pl-4">
              <SpecimenPanel />
            </div>
          </div>
        </div>

        {/* Proof band */}
        <div className="relative border-t border-primary-foreground/10">
          <div className="mx-auto max-w-6xl w-full px-6">
            <dl className="grid grid-cols-2 md:grid-cols-4">
              {proofPoints.map((p, i) => (
                <div
                  key={p.value}
                  className={`py-6 md:py-7 px-1 md:px-6 ${
                    i !== 0 ? "md:border-l border-primary-foreground/10" : ""
                  }`}
                >
                  <dt className="font-serif text-xl md:text-2xl tracking-tight">{p.value}</dt>
                  <dd className="mt-1 font-mono text-[11px] uppercase tracking-widest text-primary-foreground/60">
                    {p.label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="capabilities" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl w-full px-6 py-20 md:py-28">
          <div className="max-w-2xl mb-14">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">
              Capabilities
            </p>
            <h2 className="font-serif text-3xl md:text-4xl tracking-tight text-foreground">
              One workbench for the whole review lifecycle.
            </h2>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              Six instruments, one evidentiary chain — from first document intake to a
              signed, defensible verdict.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="group relative bg-card p-8 flex flex-col gap-4 hover-elevate transition-colors"
                data-testid={`card-feature-${f.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              >
                <span className="absolute left-0 top-0 h-0 w-px bg-primary transition-all duration-300 group-hover:h-full" />
                <div className="flex items-center justify-between">
                  <div className="w-11 h-11 rounded-lg bg-primary/5 border border-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <f.icon className="w-5 h-5" />
                  </div>
                  <span className="font-mono text-xs text-muted-foreground/70 tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="font-serif text-xl tracking-tight text-foreground">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Lifecycle */}
      <section id="lifecycle" className="scroll-mt-16 border-t border-border bg-card">
        <div className="mx-auto max-w-6xl w-full px-6 py-20 md:py-28">
          <div className="max-w-2xl mb-14">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">
              The Chain of Custody
            </p>
            <h2 className="font-serif text-3xl md:text-4xl tracking-tight text-foreground">
              From raw tender to a verdict you can defend.
            </h2>
          </div>
          <ol className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-6">
            <div
              aria-hidden
              className="hidden lg:block absolute top-3 left-0 right-0 h-px bg-border"
            />
            {lifecycle.map((s, i) => (
              <li key={s.step} className="relative">
                <div className="flex items-center gap-3 lg:block">
                  <span className="relative z-10 flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground font-mono text-[11px] tabular-nums shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="font-serif text-lg tracking-tight text-foreground lg:mt-5">
                    {s.step}
                  </h3>
                </div>
                <p className="mt-2 lg:mt-2 text-sm text-muted-foreground leading-relaxed">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CTA strip */}
      <section className="relative overflow-hidden border-t border-border bg-primary text-primary-foreground">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
        <div className="relative mx-auto max-w-6xl w-full px-6 py-16 md:py-24 flex flex-col md:flex-row md:items-center md:justify-between gap-8">
          <div className="max-w-xl">
            <p className="font-mono text-[11px] uppercase tracking-widest text-primary-foreground/60 mb-4">
              Restricted Access
            </p>
            <h2 className="font-serif text-2xl md:text-4xl tracking-tight">
              Ready to run the autopsy?
            </h2>
            <p className="mt-3 text-primary-foreground/70">
              Access is restricted to approved reviewers. Sign in to open your projects.
            </p>
          </div>
          <Button
            size="lg"
            asChild
            className="gap-2 bg-primary-foreground text-primary border-transparent shrink-0"
            data-testid="button-signin-cta"
          >
            <Link href="/sign-in">
              <Lock className="w-4 h-4" />
              Sign In
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl w-full px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-primary text-primary-foreground rounded flex items-center justify-center font-bold text-[10px]">
              VW
            </div>
            <span className="text-sm text-muted-foreground font-serif">Valo Workbench</span>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Authorized Personnel Only
          </p>
        </div>
      </footer>
    </div>
  );
}
