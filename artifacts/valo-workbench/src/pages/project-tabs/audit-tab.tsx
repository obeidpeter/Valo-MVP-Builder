import { 
  useListAudit
} from "@workspace/api-client-react";
import { Loader2, History } from "lucide-react";

export function AuditTab({ projectId }: { projectId: string }) {
  const { data: events, isLoading } = useListAudit(projectId);

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">Audit Trail</h2>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden p-6">
        {events && events.length > 0 ? (
          <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
            {events.map((event, index) => (
              <div key={event.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border border-border bg-card shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10">
                  <History className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-border bg-muted/20 shadow-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm text-foreground">{event.eventType.replace(/_/g, " ")}</span>
                    <span className="text-[10px] uppercase font-mono text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    by {event.userName || event.userId}
                  </div>
                  {event.details && (
                    <div className="mt-2 text-xs font-mono bg-background border border-border p-2 rounded truncate">
                      {JSON.stringify(event.details)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center text-muted-foreground">
            <History className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No events logged yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}