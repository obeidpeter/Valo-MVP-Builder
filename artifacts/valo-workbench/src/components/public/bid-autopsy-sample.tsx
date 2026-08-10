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
    <figure className="border border-slate-700 bg-[#101f34] text-white shadow-md">
      <div className="flex flex-col gap-3 border-b border-slate-700 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#74d6c4]">
            Representative report extract
          </p>
          <p className="mt-1 text-sm text-slate-300">
            Sample content - not a client record
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 border border-slate-600 px-3 py-1.5 text-xs text-slate-200">
          <UserRoundCheck
            aria-hidden="true"
            className="size-4 text-[#74d6c4]"
          />
          Human review recorded
        </span>
      </div>

      <div className="grid lg:grid-cols-[1fr_15rem]">
        <div className="p-5 sm:p-6">
          <div className="space-y-2">
            {reviewTrail.map((item, index) => (
              <div key={item.label}>
                <div className="grid gap-3 border border-slate-700 bg-[#13253c] p-4 sm:grid-cols-[9rem_1fr]">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#74d6c4]">
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
                    <p className="text-sm font-medium leading-6 text-slate-100">
                      {item.value}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{item.note}</p>
                  </div>
                </div>
                {index < reviewTrail.length - 1 ? (
                  <ArrowDown
                    aria-hidden="true"
                    className="mx-auto my-1 size-4 text-slate-500"
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-700 p-5 lg:border-l lg:border-t-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
            Review snapshot
          </p>
          <dl className="mt-5 space-y-5">
            <div>
              <dt className="text-xs text-slate-400">Classification</dt>
              <dd className="mt-1 font-semibold text-amber-300">
                Compliance gap
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Status</dt>
              <dd className="mt-1 font-semibold">Open</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Evidence state</dt>
              <dd className="mt-1 font-semibold">Partial</dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-xs text-slate-400">
                <Calculator aria-hidden="true" className="size-4" />
                BOQ check
              </dt>
              <dd className="mt-1 text-sm leading-6 text-slate-200">
                One line extension differs from quantity x client-supplied rate.
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <figcaption className="border-t border-slate-700 px-5 py-3 text-xs leading-5 text-slate-400">
        This example demonstrates Valo's review method. Scope and available
        checks are confirmed for each engagement.
      </figcaption>
    </figure>
  );
}
