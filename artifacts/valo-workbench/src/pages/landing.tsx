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

/**
 * LandingPage — "The Case File".
 *
 * Public cover of the Valo Bid Autopsy Workbench, sharing the sign-in page's
 * Sealed Dossier language: classification strip, registrar's seal, ledger
 * grid, hairline double rules, exhibit corner marks, and a provenance footer.
 * The hero and access-protocol sections sit on the `ink` surface, which stays
 * dark in both themes so the instrument never inverts. Accent discipline:
 * emerald = verified/audit only, amber = defect/caution only.
 */

const features = [
  {
    icon: FileSearch,
    title: "AI-Assisted Review",
    tag: "Assist",
    body: "Extract requirements, map evidence, and surface defects from tender documents — every suggestion stays inert until a named reviewer confirms it.",
  },
  {
    icon: ShieldAlert,
    title: "Deterministic Risk Scoring",
    tag: "Core",
    body: "A transparent, reproducible risk band computed only from confirmed findings. No black boxes, no unconfirmed AI noise driving the score.",
  },
  {
    icon: Calculator,
    title: "BOQ Math Checks",
    tag: "Core",
    body: "Bill-of-quantities arithmetic verified in exact integer kobo — section totals, grand totals, and words-versus-figures with zero float drift.",
  },
  {
    icon: BadgeCheck,
    title: "Certificate Vault",
    tag: "Vault",
    body: "Track client certificates with expiry telemetry and a cross-client renewal radar, so nothing lapses in the middle of a live bid.",
  },
  {
    icon: Library,
    title: "SBD Corpus",
    tag: "Corpus",
    body: "A versioned, firm-wide library of standard bidding documents and annotations — reference material every reviewer works from.",
  },
  {
    icon: FileCheck2,
    title: "Audit-Ready Reports",
    tag: "Core",
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

const accessProtocol = [
  "Access is restricted to named, approved reviewers.",
  "Every session is written to the tamper-evident audit chain.",
  "No public registration — accounts are provisioned by the registrar.",
];

/** Faint engineering-ledger grid (sign-in's texture; unique pattern id per use). */
function LedgerGrid({
  id,
  className = "pointer-events-none fixed inset-0 h-full w-full text-foreground",
}: {
  id: string;
  className?: string;
}) {
  return (
    <svg aria-hidden="true" className={className}>
      <defs>
        <pattern id={id} width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M48 0H0V48" fill="none" stroke="currentColor" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} opacity="0.05" />
    </svg>
  );
}

/** Exhibit registration corner marks. */
function CornerMarks({ className = "border-primary" }: { className?: string }) {
  const c = `absolute h-3 w-3 border-2 ${className}`;
  return (
    <>
      <span aria-hidden="true" className={`${c} -left-px -top-px border-b-0 border-r-0`} />
      <span aria-hidden="true" className={`${c} -right-px -top-px border-b-0 border-l-0`} />
      <span aria-hidden="true" className={`${c} -bottom-px -left-px border-r-0 border-t-0`} />
      <span aria-hidden="true" className={`${c} -bottom-px -right-px border-l-0 border-t-0`} />
    </>
  );
}

/** Section opener: a filing label knocked out of a hairline double rule.
    `bg` must match the section background so the knockout reads cleanly. */
function SectionRule({
  index,
  label,
  bg = "bg-background",
}: {
  index: string;
  label: string;
  bg?: string;
}) {
  return (
    <div className="relative mb-12 md:mb-14">
      <div aria-hidden="true">
        <div className="border-t border-border" />
        <div className="mt-[3px] border-t border-border/60" />
      </div>
      <p
        className={`absolute -top-2 left-0 ${bg} pr-4 font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground`}
      >
        § {index} · {label}
      </p>
    </div>
  );
}

/** Compact registrar's seal — the sign-in seal's ring vocabulary at mark size. */
function MiniSeal({ className = "h-8 w-8 text-primary" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} role="img" aria-label="Valo registrar's seal">
      <circle cx="20" cy="20" r="19" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <circle
        cx="20"
        cy="20"
        r="14.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.75"
        strokeDasharray="0.5 3"
        opacity="0.4"
      />
      <text
        x="20"
        y="21"
        textAnchor="middle"
        dominantBaseline="central"
        className="font-serif font-medium"
        fontSize="12"
        fill="currentColor"
      >
        VW
      </text>
    </svg>
  );
}

/** Hero watermark — the seal's rings, no text, cropped huge behind the chamber. */
function SealWatermark() {
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden="true"
      className="pointer-events-none absolute -right-28 -top-28 h-[30rem] w-[30rem] text-ink-foreground opacity-[0.05] animate-[spin_120s_linear_infinite] motion-reduce:animate-none"
    >
      <circle cx="60" cy="60" r="58" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="60" cy="60" r="55.5" fill="none" stroke="currentColor" strokeWidth="0.5" />
      <circle cx="60" cy="60" r="41" fill="none" stroke="currentColor" strokeWidth="0.75" />
      <circle
        cx="60"
        cy="60"
        r="37.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="0.5 3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The specimen, mounted as a labelled exhibit. Load choreography: ticks charge
    left-to-right, then the verdict confirms, then findings log in. */
function SpecimenExhibit() {
  const rows = [
    {
      ref: "F-012",
      icon: AlertTriangle,
      tone: "text-amber-400",
      text: "Mispriced BOQ line — section 4.2",
      tag: "Confirmed",
    },
    {
      ref: "F-013",
      icon: Check,
      tone: "text-emerald-400",
      text: "Tax clearance certificate valid",
      tag: "Verified",
    },
    {
      ref: "F-014",
      icon: Check,
      tone: "text-emerald-400",
      text: "Grand total reconciles to kobo",
      tag: "Verified",
    },
  ];
  return (
    <figure className="relative lg:mt-1">
      <div className="relative border border-ink-foreground/20 bg-ink-foreground/[0.04]">
        <CornerMarks className="border-ink-foreground/70" />
        <p className="absolute -top-2 left-4 whitespace-nowrap bg-ink px-3 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-foreground/60">
          Exhibit B · Specimen
        </p>
        <div className="p-5 pt-6">
          <div className="flex items-center justify-between border-b border-ink-foreground/10 pb-3">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-[valo-blip_3.2s_ease-out_infinite] motion-reduce:animate-none" />
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-ink-foreground/70">
                Specimen · BID-2026-0417
              </span>
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-foreground/60">
              Live
            </span>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-foreground/60">
                Risk Band
              </span>
              <span
                className="font-serif serif-text italic font-medium text-2xl leading-none text-amber-400 animate-in fade-in fill-mode-both duration-300 motion-reduce:animate-none"
                style={{ animationDelay: "1000ms" }}
              >
                Elevated
              </span>
            </div>
            <div className="flex gap-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 origin-left ${
                    i <= 2
                      ? "bg-amber-400/80 animate-[valo-charge_300ms_cubic-bezier(0.2,0,0,1)_both] motion-reduce:animate-none"
                      : "bg-ink-foreground/15"
                  }`}
                  style={i <= 2 ? { animationDelay: `${650 + i * 120}ms` } : undefined}
                />
              ))}
            </div>
            <div
              className="mt-1 flex justify-between font-mono text-[8px] text-ink-foreground/30"
              aria-hidden="true"
            >
              <span>0</span>
              <span>25</span>
              <span>50</span>
              <span>75</span>
              <span>100</span>
            </div>
          </div>

          <div className="mt-5 border-t border-ink-foreground/10">
            {rows.map((row, idx) => (
              <div
                key={row.ref}
                className="flex items-center gap-3 border-b border-ink-foreground/10 py-2.5 animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-500 ease-precise motion-reduce:animate-none"
                style={{ animationDelay: `${800 + idx * 140}ms` }}
              >
                <span className="w-9 shrink-0 font-mono text-[9px] tabular-nums text-ink-foreground/60">
                  {row.ref}
                </span>
                <row.icon className={`h-3.5 w-3.5 shrink-0 ${row.tone}`} />
                <span className="flex-1 truncate text-xs leading-snug text-ink-foreground/80">
                  {row.text}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-foreground/60">
                  {row.tag}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between pt-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-foreground/60">
              Reviewer: A. Okafor
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] tabular-nums text-ink-foreground/60">
              Audit #7F3A···
            </span>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.22em] text-ink-foreground/60">
        <span>Fig. 1 — Live risk assessment</span>
        <span>Scale 1:1</span>
      </figcaption>
    </figure>
  );
}

const enter =
  "animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-500 ease-precise motion-reduce:animate-none";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <LedgerGrid id="valo-landing-grid" />

      {/* Classification strip — scrolls away like a stamp on the cover */}
      <div className="relative border-b border-border bg-background">
        <p className="mx-auto max-w-6xl truncate px-4 py-2.5 text-center font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground sm:text-[10px] sm:tracking-[0.3em]">
          Confidential&nbsp;&nbsp;//&nbsp;&nbsp;Authorized personnel only
        </p>
      </div>

      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <MiniSeal />
            <div className="leading-none">
              <div className="font-serif serif-text font-semibold tracking-tight">
                Valo Workbench
              </div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                Forensic Review
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <a
              href="#capabilities"
              className="group relative hidden font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground transition-colors duration-150 hover:text-foreground sm:inline"
            >
              Capabilities
              <span
                aria-hidden="true"
                className="absolute -bottom-1.5 left-0 h-px w-full origin-left scale-x-0 bg-foreground transition-transform duration-200 ease-precise group-hover:scale-x-100 motion-reduce:transition-none"
              />
            </a>
            <a
              href="#lifecycle"
              className="group relative hidden font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground transition-colors duration-150 hover:text-foreground sm:inline"
            >
              Lifecycle
              <span
                aria-hidden="true"
                className="absolute -bottom-1.5 left-0 h-px w-full origin-left scale-x-0 bg-foreground transition-transform duration-200 ease-precise group-hover:scale-x-100 motion-reduce:transition-none"
              />
            </a>
            <Button size="sm" asChild data-testid="button-signin-nav">
              <Link href="/sign-in">Sign In</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero — the evidence chamber */}
      <section className="relative overflow-hidden bg-ink text-ink-foreground">
        <LedgerGrid
          id="valo-landing-grid-ink"
          className="pointer-events-none absolute inset-0 h-full w-full text-ink-foreground"
        />
        <SealWatermark />
        <div className="relative mx-auto w-full max-w-6xl px-6 pt-16 md:pt-24">
          {/* minmax(0,…) tracks: the specimen's flex rows have a large intrinsic
              min-content that would otherwise inflate the column past the viewport */}
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-14 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-0">
            <div className="max-w-2xl lg:pb-16 lg:pr-12">
              <div className={`mb-8 ${enter}`}>
                <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-foreground/70 sm:text-[11px]">
                  File&nbsp;&nbsp;//&nbsp;&nbsp;Bid &amp; Tender
                  Autopsy&nbsp;&nbsp;·&nbsp;&nbsp;Gate&nbsp;0&nbsp;·&nbsp;NG
                </p>
                <div aria-hidden="true" className="mt-3">
                  <div className="border-t border-ink-foreground/20" />
                  <div className="mt-[3px] border-t border-ink-foreground/10" />
                </div>
              </div>
              <h1
                className={`font-serif serif-display font-medium text-4xl tracking-tight leading-[1.05] md:text-6xl md:leading-[1.03] ${enter}`}
                style={{ animationDelay: "90ms" }}
              >
                Every bid, dissected before it costs you the{" "}
                <span className="italic text-ink-foreground/90">contract.</span>
              </h1>
              <p
                className={`mt-7 max-w-[52ch] text-lg leading-relaxed text-ink-foreground/70 ${enter}`}
                style={{ animationDelay: "180ms" }}
              >
                Valo Workbench pairs AI-assisted document review with deterministic,
                audit-ready checks — so your team catches the fatal defect, the mispriced
                BOQ line, and the expired certificate before submission, not after.
              </p>
              <p
                className={`mt-5 font-serif serif-text italic font-medium text-base text-ink-foreground/55 ${enter}`}
                style={{ animationDelay: "270ms" }}
              >
                Nothing enters the record until a named reviewer signs it.
              </p>
              <div
                className={`mt-10 flex flex-wrap items-center gap-4 ${enter}`}
                style={{ animationDelay: "270ms" }}
              >
                <Button
                  size="lg"
                  asChild
                  className="gap-2 bg-ink-foreground text-ink border-transparent focus-visible:ring-2 focus-visible:ring-ink-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
                  data-testid="button-signin-hero"
                >
                  <Link href="/sign-in" className="group">
                    Sign In to Workbench
                    <ArrowRight className="h-4 w-4 transition-transform duration-150 ease-precise group-hover:translate-x-0.5 motion-reduce:transition-none" />
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="bg-transparent text-ink-foreground [border-color:hsl(var(--ink-foreground)/0.25)] focus-visible:ring-2 focus-visible:ring-ink-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
                  data-testid="button-explore"
                >
                  <a href="#capabilities">Explore Capabilities</a>
                </Button>
              </div>
            </div>
            <div
              className={`pb-16 lg:border-l lg:border-ink-foreground/10 lg:pl-12 animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-700 ease-precise motion-reduce:animate-none`}
              style={{ animationDelay: "350ms" }}
            >
              <SpecimenExhibit />
            </div>
          </div>
        </div>

        {/* § 01 · Operating doctrine — the chamber's baseboard */}
        <div className="relative border-t border-ink-foreground/15">
          <div className="mx-auto w-full max-w-6xl px-6">
            <p className="pt-6 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-foreground/60">
              § 01 · Operating doctrine
            </p>
            <dl className="grid grid-cols-1 divide-y divide-ink-foreground/10 sm:-mx-6 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
              {proofPoints.map((p, i) => (
                <div
                  key={p.value}
                  className={`border-ink-foreground/10 py-6 sm:px-6 md:py-7 ${
                    i >= 2 ? "sm:border-t lg:border-t-0" : ""
                  } ${i !== 0 ? "lg:border-l" : ""}`}
                >
                  <dt className="flex items-baseline gap-3">
                    <span className="font-mono text-[10px] tabular-nums text-ink-foreground/60">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-serif serif-display font-medium text-2xl leading-none tracking-tight lg:text-[1.75rem]">
                      {p.value}
                    </span>
                  </dt>
                  <dd className="mt-1.5 pl-7 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-foreground/60">
                    {p.label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* § 02 · Instruments — the evidence register */}
      <section id="capabilities" className="relative scroll-mt-24">
        <div className="mx-auto w-full max-w-6xl px-6 py-20 md:py-28">
          <SectionRule index="02" label="Instruments" />
          <div className="mb-12 max-w-2xl">
            <h2 className="font-serif serif-display font-medium text-3xl tracking-tight text-foreground md:text-4xl">
              One workbench for the whole review lifecycle.
            </h2>
            <p className="mt-4 max-w-[52ch] leading-relaxed text-muted-foreground">
              Six instruments, one evidentiary chain — from first document intake to a
              signed, defensible verdict.
            </p>
          </div>
          <div className="border-y border-border">
            <div className="hidden border-b border-border px-2 py-3 font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground lg:grid lg:grid-cols-[4rem_15rem_1fr_7rem] lg:gap-6">
              <span>Ref</span>
              <span>Instrument</span>
              <span>Function</span>
              <span className="text-right">Class</span>
            </div>
            {features.map((f, i) => (
              <div
                key={f.title}
                data-testid={`card-feature-${f.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                className="group relative grid grid-cols-[3.5rem_1fr] gap-x-6 gap-y-2 border-b border-border px-2 py-6 last:border-b-0 hover-elevate md:py-7 lg:grid-cols-[4rem_15rem_1fr_7rem]"
              >
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-0 h-full w-px origin-top scale-y-0 bg-primary transition-transform duration-200 ease-precise group-hover:scale-y-100 motion-reduce:transition-none"
                />
                <span className="pt-0.5 font-mono text-sm tabular-nums text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="flex items-center gap-2.5 font-serif serif-text font-medium text-xl tracking-tight text-foreground">
                  <f.icon className="h-4 w-4 shrink-0 text-primary" />
                  {f.title}
                </h3>
                <p className="col-start-2 max-w-xl text-sm leading-relaxed text-muted-foreground lg:col-start-3">
                  {f.body}
                </p>
                <span className="col-start-2 font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground lg:col-start-4 lg:pt-1.5 lg:text-right">
                  {f.tag}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* § 03 · Chain of custody — the custody ledger */}
      <section id="lifecycle" className="relative scroll-mt-24 border-t border-border bg-card">
        <div className="mx-auto w-full max-w-6xl px-6 py-20 md:py-24">
          <SectionRule index="03" label="Chain of custody" bg="bg-card" />
          <div className="mb-12 max-w-2xl">
            <h2 className="font-serif serif-display font-medium text-3xl tracking-tight text-foreground md:text-4xl">
              From raw tender to a verdict you can defend.
            </h2>
          </div>
          <ol className="grid grid-cols-1 divide-y divide-border border border-border bg-background lg:grid-cols-5 lg:divide-x lg:divide-y-0">
            {lifecycle.map((s, i) => {
              const isGate = s.step === "Confirm";
              return (
                <li key={s.step} className="relative flex min-h-[11rem] flex-col p-6">
                  {isGate && <CornerMarks className="border-primary" />}
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.28em] tabular-nums text-muted-foreground">
                      Step {String(i + 1).padStart(2, "0")}
                    </span>
                    {isGate && (
                      <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-400">
                        Human gate
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 font-serif serif-text font-medium text-lg tracking-tight text-foreground">
                    {s.step}
                  </h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                    {s.body}
                  </p>
                  {i < lifecycle.length - 1 && (
                    <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                      → {String(i + 2).padStart(2, "0")} {lifecycle[i + 1].step}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* § 04 · Access protocol — the ink terminus */}
      <section className="relative border-t border-border bg-ink text-ink-foreground">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] items-start gap-12 px-6 py-16 md:py-20 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-20">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-foreground/60">
              § 04 · Access protocol
            </p>
            <h2 className="mt-4 max-w-xl font-serif serif-display font-medium text-2xl tracking-tight md:text-4xl">
              This workbench does not take walk-ins.
            </h2>
            <ol className="mt-8 max-w-xl border-t border-ink-foreground/15">
              {accessProtocol.map((line, i) => (
                <li key={line} className="flex gap-5 border-b border-ink-foreground/10 py-4">
                  <span className="pt-0.5 font-mono text-[11px] tabular-nums text-ink-foreground/60">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm leading-relaxed text-ink-foreground/75">{line}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="relative flex flex-col items-center border border-ink-foreground/20 p-8 text-center lg:mt-10">
            <CornerMarks className="border-ink-foreground/60" />
            <Lock className="h-5 w-5 text-ink-foreground/60" />
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-foreground/60">
              Reviewers on the roster
            </p>
            <Button
              size="lg"
              asChild
              className="mt-6 w-full gap-2 bg-ink-foreground text-ink border-transparent focus-visible:ring-2 focus-visible:ring-ink-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
              data-testid="button-signin-cta"
            >
              <Link href="/sign-in" className="group">
                <Lock className="h-4 w-4 transition-transform duration-150 ease-precise group-hover:-translate-y-px motion-reduce:transition-none" />
                Sign In
              </Link>
            </Button>
            <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.22em] text-ink-foreground/60">
              Access is logged to the audit chain
            </p>
          </div>
        </div>
      </section>

      {/* Provenance strip */}
      <footer className="relative border-t border-border bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-6 py-3 font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground sm:text-[10px]">
          <span className="inline-flex items-center gap-2">
            <MiniSeal className="h-4 w-4 text-primary" />
            Valo Workbench · Forensic review
          </span>
          <span className="hidden items-center gap-1.5 md:flex">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400"
            />
            SHA-256 audit chain · Named-reviewer sign-off
          </span>
          <span>Authorized personnel only</span>
        </div>
      </footer>
    </div>
  );
}
