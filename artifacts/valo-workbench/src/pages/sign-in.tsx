import { SignIn } from "@clerk/clerk-react";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4">
      <div className="mb-8 flex flex-col items-center">
        <div className="w-12 h-12 bg-primary text-primary-foreground rounded-lg flex items-center justify-center font-bold text-xl mb-4 shadow-sm">
          VW
        </div>
        <h1 className="text-3xl font-serif text-foreground tracking-tight">Valo Workbench</h1>
        <p className="text-muted-foreground mt-2 font-mono text-xs uppercase tracking-widest">Authorized Personnel Only</p>
      </div>
      <SignIn appearance={{
        elements: {
          rootBox: "shadow-xl border border-border rounded-xl",
          card: "bg-card shadow-none",
          headerTitle: "font-serif text-foreground",
          headerSubtitle: "text-muted-foreground",
          formButtonPrimary: "bg-primary text-primary-foreground hover:bg-primary/90",
          footerActionLink: "text-primary hover:text-primary/90",
        }
      }} />
    </div>
  );
}