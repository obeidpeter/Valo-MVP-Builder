import { useMemo, useState } from "react";
import { useGetAccessReview } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DataErrorPanel,
  LoadingPanel,
  PageHeader,
  QueueCapabilityCard,
  StateBadge,
  StatusPanel,
} from "@/components/platform-states";
import { useOnlineStatus } from "@/hooks/use-online-status";

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Africa/Lagos",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month
    ? year + "-" + month
    : new Date().toISOString().slice(0, 7);
}

function auditTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return (
    new Intl.DateTimeFormat("en-NG", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Lagos",
    }).format(parsed) + " WAT"
  );
}

export default function SecurityAudit() {
  const online = useOnlineStatus();
  const [month, setMonth] = useState(currentMonth);
  const query = useGetAccessReview({ month, format: "json" });
  const review = useMemo(
    () =>
      query.data && typeof query.data !== "string" ? query.data : undefined,
    [query.data],
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Restricted administration"
        title="Security & audit"
        description="Attributed access-review evidence and the status of security queues that require independent, server-enforced controls."
        state={!online ? "offline" : query.isError ? "error" : "active"}
      />

      <StatusPanel
        state="partial"
        title="Immutability assurance is incomplete"
        description="The access review is available, but this interface has no evidence that audit events are externally anchored or retained in immutable storage. A locally rewriteable chain must not be treated as sufficient tamper protection."
      />

      <section
        aria-labelledby="security-controls-heading"
        className="space-y-4"
      >
        <h2
          id="security-controls-heading"
          className="font-serif text-xl font-semibold"
        >
          Security queue coverage
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <QueueCapabilityCard
            title="Access review"
            description="Monthly attributed access rows are connected below."
            state="active"
          />
          <QueueCapabilityCard
            title="Break-glass access"
            description="Time-limited emergency access, independent approval and closure evidence are not exposed."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="Retention and deletion"
            description="Retention configuration exists; legal hold, deletion certificate and DSAR queues are not connected here."
            state="partial"
          />
          <QueueCapabilityCard
            title="Security events"
            description="A dedicated incident and anomalous-access review queue is not available to this frontend."
            state="unavailable"
          />
        </div>
      </section>

      <section aria-labelledby="access-review-heading" className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              id="access-review-heading"
              className="font-serif text-xl font-semibold"
            >
              Monthly access review
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Rows are returned by the server for the selected reporting month.
            </p>
          </div>
          <div className="w-full max-w-48 space-y-2">
            <Label htmlFor="access-review-month">Reporting month</Label>
            <Input
              id="access-review-month"
              type="month"
              value={month}
              max={currentMonth()}
              onChange={(event) => {
                if (/^\d{4}-\d{2}$/.test(event.target.value))
                  setMonth(event.target.value);
              }}
            />
          </div>
        </div>

        {query.isLoading ? (
          <LoadingPanel label="Loading monthly access review" />
        ) : null}
        {query.isError ? (
          <DataErrorPanel
            title="Access review could not be loaded"
            description="Do not interpret missing rows as no access. Check connectivity and role authorisation, then retry."
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {query.data && typeof query.data === "string" ? (
          <DataErrorPanel
            title="Unexpected access-review format"
            description="The server returned a text report when structured JSON was requested. No rows are displayed."
          />
        ) : null}

        {review && review.rows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[920px] text-left text-sm">
              <caption className="sr-only">
                Attributed access events for {review.month}
              </caption>
              <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Time
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Actor
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Client / project
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Action
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Object
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {review.rows.map((row, index) => (
                  <tr key={row.at + "-" + row.objectId + "-" + index}>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                      {auditTime(row.at)}
                    </td>
                    <td className="px-4 py-3">
                      {row.actor || "Actor unavailable"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block">
                        {row.client || "Client unavailable"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {row.project || "Project unavailable"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge
                        state="active"
                        label={row.action || "Recorded"}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="block">
                        {row.objectType || "Object"}
                      </span>
                      <span className="block font-mono text-muted-foreground">
                        {row.objectId || "ID unavailable"}
                      </span>
                    </td>
                    <td className="max-w-sm px-4 py-3 text-xs text-muted-foreground">
                      {row.details || "No additional detail"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : review && review.rows.length === 0 ? (
          <StatusPanel
            state="empty"
            title="No access rows returned"
            description="The selected report is empty. Confirm audit ingestion and immutable retention before accepting this as evidence of no access."
          />
        ) : null}
      </section>
    </div>
  );
}
