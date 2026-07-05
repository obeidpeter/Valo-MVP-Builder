import { SignIn } from "@clerk/clerk-react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

/**
 * SignInPage — "The Sealed Dossier".
 *
 * Unauthenticated landing for the Valo Bid Autopsy Workbench. Reads as the
 * cover of a confidential case file: registrar's seal, legal-stationery
 * masthead with hairline double rules, a classification strip, and the Clerk
 * sign-in card mounted as Exhibit A with registration corner marks. All
 * color comes from theme tokens so dark mode holds; the only accent is the
 * emerald audit tick in the provenance footer.
 */

/** Faint engineering-ledger grid over the whole page (both themes via currentColor). */
function LedgerGrid() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 h-full w-full text-foreground"
    >
      <defs>
        <pattern id="valo-page-grid" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M48 0H0V48" fill="none" stroke="currentColor" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#valo-page-grid)" opacity="0.05" />
    </svg>
  );
}

/** Registrar's seal — inline SVG, currentColor only, one near-static rotation. */
function RegistrarSeal() {
  return (
    <svg
      viewBox="0 0 120 120"
      className="h-24 w-24 text-primary sm:h-28 sm:w-28"
      role="img"
      aria-label="Valo Workbench registrar's seal"
    >
      <circle cx="60" cy="60" r="58" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55" />
      <circle cx="60" cy="60" r="55.5" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.3" />
      <circle cx="60" cy="60" r="41" fill="none" stroke="currentColor" strokeWidth="0.75" opacity="0.45" />
      <circle
        cx="60"
        cy="60"
        r="37.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="0.5 3.5"
        strokeLinecap="round"
        opacity="0.35"
      />

      {/* Circumferential legend — rotates once every two minutes; textLength pins
          the legend to the exact circumference so the ring closes cleanly. */}
      <g className="origin-center animate-[spin_120s_linear_infinite] motion-reduce:animate-none">
        <defs>
          <path
            id="valo-seal-path"
            d="M 60,60 m -48,0 a 48,48 0 1,1 96,0 a 48,48 0 1,1 -96,0"
            fill="none"
          />
        </defs>
        <text className="font-mono uppercase" fontSize="6.4" fill="currentColor" opacity="0.75">
          <textPath href="#valo-seal-path" startOffset="0" textLength="301" lengthAdjust="spacingAndGlyphs">
            Valo Bid Autopsy Workbench · Forensic Review · Chain of Custody ·&#160;
          </textPath>
        </text>
      </g>

      <text
        x="60"
        y="58"
        textAnchor="middle"
        dominantBaseline="central"
        className="font-serif"
        fontSize="23"
        fill="currentColor"
      >
        VW
      </text>
      <line x1="47" y1="70.5" x2="73" y2="70.5" stroke="currentColor" strokeWidth="0.5" opacity="0.5" />
      <text
        x="60"
        y="78"
        textAnchor="middle"
        dominantBaseline="central"
        className="font-mono uppercase"
        fontSize="5.2"
        letterSpacing="1.6"
        fill="currentColor"
        opacity="0.7"
      >
        Gate 0 · NG
      </text>
    </svg>
  );
}

/** Legal-stationery hairline double rule. */
function DoubleRule({ className = "" }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <div className="border-t border-border" />
      <div className="mt-[3px] border-t border-border/60" />
    </div>
  );
}

export default function SignInPage() {
  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      <LedgerGrid />

      {/* ── Classification strip ─────────────────────────────────────────── */}
      <header className="relative border-b border-border">
        <p className="mx-auto max-w-3xl truncate px-4 py-2.5 text-center font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground sm:text-[10px] sm:tracking-[0.3em]">
          Confidential&nbsp;&nbsp;//&nbsp;&nbsp;Authorized personnel only
        </p>
      </header>

      {/* ── Dossier cover ────────────────────────────────────────────────── */}
      <main className="relative mx-auto flex w-full max-w-md flex-1 flex-col items-center px-4 py-10 sm:max-w-lg sm:py-12">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 self-start font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground"
          data-testid="link-back-home"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to home
        </Link>

        {/* Seal + masthead */}
        <section className="flex w-full flex-col items-center text-center animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-700">
          <RegistrarSeal />

          <DoubleRule className="mt-8 w-full" />

          <h1 className="mt-6 font-serif text-3xl leading-tight tracking-tight text-foreground sm:text-4xl">
            Bid Autopsy Workbench
          </h1>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
            Valo &middot; Forensic tender review &middot; Nigeria
          </p>

          <DoubleRule className="mt-6 w-full" />

          <p className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80">
            <span className="whitespace-nowrap">Deterministic core</span>
            <span aria-hidden="true">&middot;</span>
            <span className="whitespace-nowrap">LLM shell</span>
            <span aria-hidden="true">&middot;</span>
            <span className="whitespace-nowrap">Named-human sign-off</span>
          </p>
        </section>

        {/* Mounted exhibit: the sign-in card */}
        <section
          className="mt-10 w-full animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-700"
          style={{ animationDelay: "200ms" }}
        >
          <p className="mb-4 text-center font-serif text-lg italic text-muted-foreground">
            State your identity for the record.
          </p>

          <div className="relative border border-border bg-card shadow-sm">
            {/* Registration corner marks */}
            <span aria-hidden="true" className="absolute -left-px -top-px h-3 w-3 border-l-2 border-t-2 border-primary" />
            <span aria-hidden="true" className="absolute -right-px -top-px h-3 w-3 border-r-2 border-t-2 border-primary" />
            <span aria-hidden="true" className="absolute -bottom-px -left-px h-3 w-3 border-b-2 border-l-2 border-primary" />
            <span aria-hidden="true" className="absolute -bottom-px -right-px h-3 w-3 border-b-2 border-r-2 border-primary" />

            {/* Exhibit tab set into the top rule */}
            <p className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap bg-background px-3 font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
              Exhibit A &middot; Access
            </p>

            <div className="flex justify-center px-4 py-8 sm:px-6">
              <SignIn
                appearance={{
                  elements: {
                    rootBox: "w-full flex justify-center",
                    cardBox: "w-full flex justify-center shadow-none",
                    card: "w-full bg-card border-0 shadow-none",
                    header: "text-center",
                    headerTitle: "font-serif text-foreground",
                    headerSubtitle: "text-muted-foreground",
                    formButtonPrimary:
                      "bg-primary text-primary-foreground hover:bg-primary/90 shadow-none",
                    formFieldLabel: "text-foreground",
                    formFieldInput: "bg-background border-border text-foreground",
                    socialButtonsBlockButton: "border-border text-foreground hover:bg-muted",
                    dividerLine: "bg-border",
                    dividerText: "text-muted-foreground",
                    identityPreview: "bg-muted border-border",
                    footerActionText: "text-muted-foreground",
                    footerActionLink: "text-primary hover:text-primary/80",
                  },
                }}
              />
            </div>
          </div>

          <p className="mt-5 text-center font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground/70">
            Access is logged to the audit chain
          </p>
        </section>
      </main>

      {/* ── Provenance strip ─────────────────────────────────────────────── */}
      <footer className="relative border-t border-border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-6 py-3 font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground sm:px-10 sm:text-[10px]">
          <span>Engine valo-autopsy-engine/gate0-v1</span>
          <span className="hidden items-center gap-1.5 md:flex">
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600" />
            SHA-256 audit chain &middot; Named-reviewer sign-off
          </span>
          <span>Confidential</span>
        </div>
      </footer>
    </div>
  );
}
