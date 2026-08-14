// ---------------------------------------------------------------------------
// Gate 0 founder metrics (Build Brief §17)
// ---------------------------------------------------------------------------

/**
 * The Gate 0 commercial thresholds, taken verbatim from the Build Brief §17
 * "Founder Gate 0 Metrics to Track Inside the App". These are the pass bars the
 * founder measures demand against before building the public platform; they are
 * NOT a pass/kill automation — the app only surfaces value-vs-threshold.
 */
export const GATE0_THRESHOLDS = {
  /** Decision-maker (owner/MD) conversations, excluding junior bid staff. */
  decisionMakerConversations: 8,
  /** Tender+bid pairs shared under a signed/not-required NDA. */
  packagesUnderNda: 5,
  /** Share of audited packages with a fatal/likely-fatal defect. */
  materialDefectRate: 0.5,
  /** Prepaid mandates won. */
  paidMandates: 3,
  /** Paid mandates that are an assisted-bid or retainer (not autopsy-only). */
  mandateQuality: 1,
} as const;

export type Gate0MetricKey = keyof typeof GATE0_THRESHOLDS;

export interface Gate0Metric {
  key: Gate0MetricKey;
  label: string;
  description: string;
  value: number;
  threshold: number;
  comparator: "gte";
  unit: "count" | "ratio";
  met: boolean;
}

export interface Gate0Readiness {
  metrics: Gate0Metric[];
  metCount: number;
  totalCount: number;
}

/** Raw observed values feeding the Gate 0 readiness view. */
export interface Gate0Input {
  decisionMakerConversations: number;
  packagesUnderNda: number;
  /** 0..1 share of audited packages with a material defect. */
  materialDefectRate: number;
  paidMandates: number;
  /** Count of paid mandates that are an assisted bid or retainer. */
  mandateQuality: number;
}

/**
 * Pure assembly of the Gate 0 readiness view: pairs each observed value with
 * its Build Brief threshold and marks whether the bar is met (value >= bar).
 * Kept deterministic and DB-free so it is unit-testable and the API route only
 * has to supply the aggregates.
 */
export function assembleGate0(input: Gate0Input): Gate0Readiness {
  const defs: Omit<Gate0Metric, "value" | "threshold" | "met">[] = [
    {
      key: "decisionMakerConversations",
      label: "Decision-maker conversations",
      description: "Conversations with owners/MDs, not junior bid staff.",
      comparator: "gte",
      unit: "count",
    },
    {
      key: "packagesUnderNda",
      label: "Packages under NDA",
      description: "Tender+bid pairs shared under a signed NDA.",
      comparator: "gte",
      unit: "count",
    },
    {
      key: "materialDefectRate",
      label: "Material defect rate",
      description: "Fatal/likely-fatal defects across audited packages.",
      comparator: "gte",
      unit: "ratio",
    },
    {
      key: "paidMandates",
      label: "Paid mandates",
      description: "Prepaid mandates within six weeks of first autopsy.",
      comparator: "gte",
      unit: "count",
    },
    {
      key: "mandateQuality",
      label: "Mandate quality",
      description: "Paid mandates that are an assisted bid or retainer.",
      comparator: "gte",
      unit: "count",
    },
  ];

  const metrics: Gate0Metric[] = defs.map((d) => {
    const rawValue = input[d.key];
    const value = Number.isFinite(rawValue) ? rawValue : 0;
    const threshold = GATE0_THRESHOLDS[d.key];
    return { ...d, value, threshold, met: value >= threshold };
  });

  return {
    metrics,
    metCount: metrics.filter((m) => m.met).length,
    totalCount: metrics.length,
  };
}
