import {
  ArrowDown,
  BadgeCheck,
  Calculator,
  FileSearch,
  Link2,
  UserRoundCheck,
} from "lucide-react";

const reviewTrail = [
  {
    label: "Tender source",
    value: "Sample ITT / clause 4.2 / page 18",
    note: "Source location retained",
  },
  {
    label: "Extracted requirement",
    value: "Provide a valid tax clearance certificate for the stated period.",
    note: "Confirmed by a reviewer",
  },
  {
    label: "Evidence match",
    value: "Certificate found; one required year is not evidenced.",
    note: "Partial match",
  },
  {
    label: "Finding and action",
    value:
      "Compliance gap / obtain and verify the missing year before release.",
    note: "Owner: Compliance lead",
  },
] as const;

export function BidAutopsySample() {
  return (
    <figure className="overflow-hidden rounded-2xl border border-sidebar-border bg-sidebar-accent/70 text-sidebar-foreground shadow-[0_28px_80px_-42px_hsl(var(--sidebar-primary)/0.75)]">
      <div className="flex flex-col gap-3 border-b border-sidebar-border bg-sidebar-accent px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sidebar-primary">
            Representative report extract
          </p>
          <p className="mt-1 text-sm text-sidebar-foreground/65">
            Sample content - not a client record
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-sidebar-border bg-sidebar px-3 py-1.5 text-xs text-sidebar-foreground/80">
          <UserRoundCheck
            aria-hidden="true"
            className="size-4 text-sidebar-primary"
          />
          Human review recorded
        </span>
      </div>

      <div className="grid bg-sidebar/45 lg:grid-cols-[1fr_16rem]">
        <div className="p-5 sm:p-6">
          <div className="space-y-2">
            {reviewTrail.map((item, index) => (
              <div key={item.label}>
                <div className="grid gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent p-4 shadow-sm sm:grid-cols-[9rem_1fr]">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-sidebar-primary">
                    {index === 0 ? (
                      <FileSearch aria-hidden="true" className="size-4" />
                    ) : index === 1 ? (
                      <Link2 aria-hidden="true" className="size-4" />
                    ) : index === 2 ? (
                      <BadgeCheck aria-hidden="true" className="size-4" />
                    ) : (
                      <UserRoundCheck aria-hidden="true" className="size-4" />
                    )}
                    {item.label}
                  </div>
                  <div>
                    <p className="text-sm font-medium leading-6 text-sidebar-foreground">
                      {item.value}
                    </p>
                    <p className="mt-1 text-xs text-sidebar-foreground/60">
                      {item.note}
                    </p>
                  </div>
                </div>
                {index < reviewTrail.length - 1 ? (
                  <ArrowDown
                    aria-hidden="true"
                    className="mx-auto my-1 size-4 text-sidebar-primary/45"
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-sidebar-border bg-sidebar-accent/60 p-5 lg:border-l lg:border-t-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/60">
            Review snapshot
          </p>
          <dl className="mt-5 space-y-5">
            <div>
              <dt className="text-xs text-sidebar-foreground/60">
                Classification
              </dt>
              <dd className="mt-1 font-semibold text-amber-300">
                Compliance gap
              </dd>
            </div>
            <div>
              <dt className="text-xs text-sidebar-foreground/60">Status</dt>
              <dd className="mt-1 font-semibold">Open</dd>
            </div>
            <div>
              <dt className="text-xs text-sidebar-foreground/60">
                Evidence state
              </dt>
              <dd className="mt-1 font-semibold">Partial</dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-xs text-sidebar-foreground/60">
                <Calculator aria-hidden="true" className="size-4" />
                BOQ check
              </dt>
              <dd className="mt-1 text-sm leading-6 text-sidebar-foreground/75">
                One line extension differs from quantity x client-supplied rate.
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <figcaption className="border-t border-sidebar-border bg-sidebar-accent px-5 py-3 text-xs leading-5 text-sidebar-foreground/60">
        This example demonstrates Valo's review method. Scope and available
        checks are confirmed for each engagement.
      </figcaption>
    </figure>
  );
}
