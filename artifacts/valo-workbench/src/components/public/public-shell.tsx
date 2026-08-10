import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import { BidAutopsyCta } from "@/components/public/public-primary-cta";
import { Button } from "@/components/ui/button";
import { ValoMark } from "@/components/valo-mark";

const NAVIGATION = [
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/#what-we-check", label: "What We Check" },
  { href: "/#services", label: "Services" },
  { href: "/#trust", label: "Trust" },
  { href: "/#faq", label: "FAQ" },
] as const;

function PublicNavigation({
  onNavigate,
  firstLinkRef,
}: {
  onNavigate?: () => void;
  firstLinkRef?: RefObject<HTMLAnchorElement | null>;
}) {
  return (
    <nav aria-label="Public navigation">
      <ul className="flex flex-col gap-1 lg:flex-row lg:items-center">
        {NAVIGATION.map((item, index) => (
          <li key={item.href}>
            <a
              ref={index === 0 ? firstLinkRef : undefined}
              href={item.href}
              onClick={onNavigate}
              className="flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstMobileLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => setMobileOpen(false), [location]);

  useEffect(() => {
    if (!mobileOpen) return;
    window.requestAnimationFrame(() => firstMobileLinkRef.current?.focus());
  }, [mobileOpen]);

  function closeMobileMenu({ restoreFocus = false } = {}) {
    setMobileOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!mobileOpen || event.key !== "Escape") return;
    event.preventDefault();
    closeMobileMenu({ restoreFocus: true });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#public-main"
        className="sr-only z-50 rounded-md bg-card px-4 py-2 text-sm font-medium shadow-sm focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      <header
        className="sticky top-0 z-40 border-b border-border bg-background/95"
        onKeyDown={handleMenuKeyDown}
      >
        <div className="content-shell flex min-h-16 items-center justify-between gap-4">
          <Link
            href="/"
            aria-label="Valo home"
            className="inline-flex min-h-11 min-w-11 items-center rounded-md text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ValoMark />
          </Link>
          <div className="hidden items-center gap-3 lg:flex">
            <PublicNavigation />
            <div className="ml-2 flex items-center gap-2 border-l border-border pl-4">
              <Button asChild variant="ghost" className="min-h-11">
                <Link href="/sign-in">Sign In</Link>
              </Button>
              <BidAutopsyCta />
            </div>
          </div>
          <button
            ref={menuButtonRef}
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            aria-expanded={mobileOpen}
            aria-controls="public-mobile-navigation"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => {
              if (mobileOpen) closeMobileMenu();
              else setMobileOpen(true);
            }}
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
              <PublicNavigation
                firstLinkRef={firstMobileLinkRef}
                onNavigate={() => closeMobileMenu()}
              />
              <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-2">
                <Button asChild variant="outline" className="min-h-11">
                  <Link href="/sign-in">Sign In</Link>
                </Button>
                <BidAutopsyCta />
              </div>
            </div>
          </div>
        ) : null}
      </header>

      <main id="public-main">{children}</main>

      <footer className="border-t border-border bg-card">
        <div className="content-shell grid gap-10 py-12 md:grid-cols-[1.35fr_1fr_1fr]">
          <div className="max-w-md space-y-4">
            <ValoMark className="text-primary" />
            <p className="text-sm leading-6 text-muted-foreground">
              Designed for AI-assisted, human-verified bid readiness and
              disqualification defence for Nigerian public, oil-and-gas and
              donor-funded tenders. Model-assisted steps operate only where
              provider, privacy and evaluation gates are approved; human review
              remains authoritative.
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              Valo strengthens review and remediation. It does not guarantee an
              award, evaluator acceptance or the absence of all bid risk.
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold">Explore</h2>
            <ul className="mt-2 text-sm text-muted-foreground">
              {NAVIGATION.map((item) => (
                <li key={item.href}>
                  <a
                    className="flex min-h-11 items-center hover:text-foreground"
                    href={item.href}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold">Valo</h2>
            <ul className="mt-2 text-sm text-muted-foreground">
              <li>
                <Link
                  className="flex min-h-11 items-center hover:text-foreground"
                  href="/request-bid-autopsy"
                >
                  Bid enquiries
                </Link>
              </li>
              <li>
                <Link
                  className="flex min-h-11 items-center hover:text-foreground"
                  href="/sign-in"
                >
                  Sign In
                </Link>
              </li>
              <li>
                <Link
                  className="flex min-h-11 items-center hover:text-foreground"
                  href="/security"
                >
                  Security and trust
                </Link>
              </li>
              <li>
                <Link
                  className="flex min-h-11 items-center hover:text-foreground"
                  href="/privacy"
                >
                  Privacy
                </Link>
              </li>
              <li>
                <Link
                  className="flex min-h-11 items-center hover:text-foreground"
                  href="/terms"
                >
                  Terms
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border">
          <div className="content-shell flex flex-col gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>&copy; {new Date().getFullYear()} Valo. All rights reserved.</p>
            <p>Nigeria-focused. Human-reviewed. Audit-conscious.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
