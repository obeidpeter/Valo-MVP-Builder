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

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl w-full px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary text-primary-foreground rounded flex items-center justify-center font-bold text-sm">
              VW
            </div>
            <div className="leading-none">
              <div className="font-serif font-semibold tracking-tight">Valo Workbench</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1 font-mono">
                Forensic Review
              </div>
            </div>
          </div>
          <Button size="sm" asChild data-testid="button-signin-nav">
            <Link href="/sign-in">Sign In</Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl w-full px-6 py-20 md:py-28">
          <div className="max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-6">
              Bid &amp; Tender Autopsy Platform
            </p>
            <h1 className="font-serif text-4xl md:text-6xl tracking-tight leading-[1.05] text-foreground">
              Every bid, dissected before it costs you the contract.
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl">
              Valo Workbench pairs AI-assisted document review with deterministic,
              audit-ready checks — so your team catches the fatal defect, the mispriced
              BOQ line, and the expired certificate before submission, not after.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Button size="lg" className="gap-2" asChild data-testid="button-signin-hero">
                <Link href="/sign-in">
                  Sign In to Workbench
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild data-testid="button-explore">
                <a href="#capabilities">Explore Capabilities</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="capabilities" className="flex-1">
        <div className="mx-auto max-w-6xl w-full px-6 py-20">
          <div className="max-w-2xl mb-14">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">
              Capabilities
            </p>
            <h2 className="font-serif text-3xl md:text-4xl tracking-tight text-foreground">
              One workbench for the whole review lifecycle.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border rounded-lg overflow-hidden">
            {features.map((f) => (
              <div
                key={f.title}
                className="bg-card p-8 flex flex-col gap-4"
                data-testid={`card-feature-${f.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              >
                <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                  <f.icon className="w-5 h-5" />
                </div>
                <h3 className="font-serif text-xl tracking-tight text-foreground">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA strip */}
      <section className="border-t border-border bg-card">
        <div className="mx-auto max-w-6xl w-full px-6 py-16 flex flex-col md:flex-row md:items-center md:justify-between gap-8">
          <div className="max-w-xl">
            <h2 className="font-serif text-2xl md:text-3xl tracking-tight text-foreground">
              Ready to run the autopsy?
            </h2>
            <p className="mt-3 text-muted-foreground">
              Access is restricted to approved reviewers. Sign in to open your projects.
            </p>
          </div>
          <Button size="lg" className="gap-2" asChild data-testid="button-signin-cta">
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
