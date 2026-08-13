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
  "NG-PHCDA-2026-021-consumables",
  "NG-TCN-2026-108-substation",
  "NG-UBEC-2026-055-classrooms",
  "NG-NIPEX-2026-DR-0087-drilling",
  "NG-FMWR-2026-042-boreholes",
  "NG-FIRS-2026-077-ict",
  "NG-NDDC-2026-019-shoreline",
  "NG-DSS-2026-090-catering",
  "NG-NNPC-2026-PL-033-pipeline",
  "NG-REA-2026-064-minigrid",
  "NG-FAAN-2026-112-groundhandling",
] as const;

export const CURRENT_CORPUS_MANIFEST: EvalCorpusManifest = {
  schemaVersion: 1,
  corpusVersion: "gate0-inline-synthetic-v2",
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
