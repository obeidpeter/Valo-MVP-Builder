import { useGetMe } from "@workspace/api-client-react";
import { Loader2, ShieldAlert } from "lucide-react";

export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useGetMe();

  if (isLoading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center">
        <div className="max-w-md w-full space-y-4">
          <div className="w-16 h-16 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mx-auto">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-serif tracking-tight">Access Denied</h1>
          <p className="text-muted-foreground">
            The Settings area is restricted to administrators. You do not have permission to view this page.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
