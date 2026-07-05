import { Link, useLocation } from "wouter";
import { useAuth, UserButton } from "@clerk/clerk-react";
import { useGetMe } from "@workspace/api-client-react";
import { Loader2, Briefcase, Users, LayoutDashboard, Settings, FileSearch, CheckCircle, Library } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: user, isLoading, error } = useGetMe();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="font-mono text-sm tracking-widest uppercase">Authenticating...</p>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-destructive">
          <p className="font-mono text-sm tracking-widest uppercase">Authentication Failed</p>
        </div>
      </div>
    );
  }

  if (user.status === "disabled" || user.role === "none") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 bg-muted text-muted-foreground rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-serif tracking-tight">Pending Access</h1>
          <p className="text-muted-foreground">
            Your account has been created, but it requires administrator approval before you can access the workbench.
          </p>
          <div className="pt-8">
            <UserButton afterSignOutUrl="/sign-in" />
          </div>
        </div>
      </div>
    );
  }

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/clients", label: "Clients", icon: Users },
    { href: "/projects", label: "Projects", icon: Briefcase },
    { href: "/sbd", label: "SBD Corpus", icon: Library },
    ...(user.role === "admin" ? [{ href: "/settings", label: "Settings", icon: Settings }] : []),
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      <aside className="w-full md:w-64 border-r border-border bg-card flex flex-col shrink-0">
        <div className="p-6 border-b border-border flex items-center gap-3">
          <div className="w-8 h-8 bg-primary text-primary-foreground rounded flex items-center justify-center font-bold text-sm">
            VW
          </div>
          <div>
            <h2 className="font-serif font-semibold tracking-tight text-foreground leading-none">Valo Workbench</h2>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1 font-mono">Forensic Review</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors cursor-pointer group",
                    isActive 
                      ? "bg-primary/10 text-primary font-medium" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border mt-auto">
          <div className="flex items-center gap-3 bg-muted/50 p-3 rounded-md">
            <UserButton afterSignOutUrl="/sign-in" />
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium truncate">{user.name || user.email}</span>
              <span className="text-xs text-muted-foreground uppercase font-mono tracking-wider">{user.role}</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 h-[100dvh] overflow-y-auto">
        {children}
      </main>
    </div>
  );
}