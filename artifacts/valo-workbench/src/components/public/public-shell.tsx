import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ValoMark } from "@/components/valo-mark";
import { cn } from "@/lib/utils";

const NAVIGATION = [
  { href: "/product", label: "Product" },
  { href: "/solutions", label: "Solutions" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Security" },
  { href: "/about", label: "About" },
] as const;

function PublicNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  return (
    <nav aria-label="Public navigation">
      <ul className="flex flex-col gap-1 lg:flex-row lg:items-center lg:gap-1">
        {NAVIGATION.map((item) => {
          const active = location === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();

  useEffect(() => setMobileOpen(false), [location]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#public-main"
        className="sr-only z-50 rounded-md bg-card px-4 py-2 text-sm font-medium shadow-sm focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="content-shell flex min-h-16 items-center justify-between gap-4">
          <Link
            href="/"
            aria-label="Valo home"
            className="rounded-md text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ValoMark />
          </Link>
          <div className="hidden items-center gap-3 lg:flex">
            <PublicNavigation />
            <div className="ml-2 flex items-center gap-2 border-l border-border pl-4">
              <Button asChild variant="ghost">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild>
                <Link href="/contact">
                  Request a walkthrough
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-card lg:hidden"
            aria-expanded={mobileOpen}
            aria-controls="public-mobile-navigation"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? (
              <X aria-hidden="true" className="size-5" />
            ) : (
              <Menu aria-hidden="true" className="size-5" />
            )}
          </button>
        </div>
        {mobileOpen ? (
          <div
            id="public-mobile-navigation"
            className="border-t border-border bg-card lg:hidden"
          >
            <div className="content-shell space-y-4 py-4">
              <PublicNavigation onNavigate={() => setMobileOpen(false)} />
              <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-2">
                <Button asChild variant="outline">
                  <Link href="/sign-in">Sign in</Link>
                </Button>
                <Button asChild>
                  <Link href="/contact">Request a walkthrough</Link>
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </header>

      <main id="public-main">{children}</main>

      <footer className="border-t border-border bg-card">
        <div className="content-shell grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="max-w-md space-y-4">
            <ValoMark className="text-primary" />
            <p className="text-sm leading-6 text-muted-foreground">
              Evidence-led tender controls for teams that need every
              requirement, claim and approval to remain reviewable.
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              Valo supports a controlled process. It does not guarantee contract
              award, evaluator behaviour or acceptance of a submission.
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold">Explore</h2>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              {NAVIGATION.slice(0, 4).map((item) => (
                <li key={item.href}>
                  <Link className="hover:text-foreground" href={item.href}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold">Company</h2>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li>
                <Link className="hover:text-foreground" href="/about">
                  About
                </Link>
              </li>
              <li>
                <Link className="hover:text-foreground" href="/contact">
                  Contact
                </Link>
              </li>
              <li>
                <Link className="hover:text-foreground" href="/privacy">
                  Privacy
                </Link>
              </li>
              <li>
                <Link className="hover:text-foreground" href="/terms">
                  Terms
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border">
          <div className="content-shell flex flex-col gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>&copy; {new Date().getFullYear()} Valo. All rights reserved.</p>
            <p>Nigeria-ready. Human-reviewed. Audit-conscious.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
