import type { EvalCorpusManifest } from "../../src/lib/evalHarness";

/**
 * Honest metadata for the repository's current inline fixtures.
 *
 * These cases are useful for deterministic matcher regression only. They have
 * no retained source artefacts, authorisation records, independent annotation
 * evidence or holdout separation and therefore cannot promote production AI.
 */
const SYNTHETIC_CASE_IDS = [
  "VMT-2026-014-chemicals",
  "NNPC-2026-207-piping",
  "KZN-HEALTH-2026-031-ppe",
  "EGH-2026-118-roadworks",
  "UNIV-2026-045-ict",
  "CITY-2026-089-fleet",
  "PWR-2026-160-solar",
  "EDU-2026-072-catering",
  "PORT-2026-019-security",
  "AGRI-2026-133-irrigation",
  "HOSP-2026-058-laundry",
  "NG-FMOH-2026-014-lab-equipment",
  "NG-NIPEX-2026-ML-0042-marine",
  "NG-FMW-2026-road-rehab",
] as const;

export const CURRENT_CORPUS_MANIFEST: EvalCorpusManifest = {
  schemaVersion: 1,
  corpusVersion: "gate0-inline-synthetic-v1",
  purpose: "non_production_self_check",
  limitations: [
    "Inline synthetic-style text only; no retained source-document artefacts.",
    "Authorisation, annotator identity, independent review and agreement are not documented.",
    "No poor-scan, layout, OCR, addendum, donor-funded or difficult-negative holdout proof.",
    "Must not be used as production quality or customer-data coverage evidence.",
  ],
  cases: SYNTHETIC_CASE_IDS.map((tenderId) => ({
    tenderId,
    sourceCategory: "synthetic_public_procurement_scenario",
    sourceReferenceHash: null,
    authorizationBasis: "synthetic_no_customer_data",
    synthetic: true,
    productionEligible: false,
    split: "development",
    cohorts: [],
    annotationStatus: "unverified",
    annotatorIds: [],
    independentReviewerIds: [],
    agreementMethod: null,
    containsRawSensitiveData: false,
  })),
};
