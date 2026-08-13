import type {
  BoqCommercialLine,
  BoqException,
  BoqLotSummary,
  BoqRulePolicy,
} from "../boqVerifier";

export const BOQ_VERIFICATION_READ_PERMISSION = "defect:read" as const;
export const BOQ_VERIFICATION_RUN_PERMISSION = "defect:write" as const;
export const BOQ_VERIFICATION_RESOLVE_PERMISSION = "defect:review" as const;

export const BOQ_VERIFIER_VERSION = "commercial-boq-verifier/v1" as const;
export const BOQ_WORKBOOK_MANIFEST_SCHEMA =
  "valo.boq-workbook-manifest/v1" as const;

export const BOQ_VERIFICATION_BOUNDS = Object.freeze({
  linesPerRun: 2_000,
  lotsPerRun: 50,
  runsListedPerProject: 200,
  exceptionsPerRun: 4_000,
  identifierCharacters: 120,
  decimalCharacters: 40,
  resolutionReasonCharacters: 500,
});

/**
 * The pinned Nigeria commercial rule pack. VAT is 7.5% (750 basis points) for
 * NGN per the Finance Act rate in force at pack issue. WHT verification stays
 * disabled pending legal sign-off of category-specific rates; declaring WHT in
 * a submitted lot therefore raises the kernel's `wht_rule_disabled` exception
 * rather than silently accepting an unreviewed convention. Clients never
 * supply the policy: the server pins it and records the pack id on every run.
 */
export const NG_COMMERCIAL_BOQ_RULE_PACK: BoqRulePolicy = Object.freeze({
  rulePackId: "ng-commercial-boq/v1",
  currencyMinorDigits: Object.freeze({ NGN: 2 }),
  permittedRoundingMinor: "0.01",
  vatRateBasisPointsByCurrency: Object.freeze({ NGN: 750 }),
  whtEnabled: false,
  whtRateBasisPoints: null,
});

export const BOQ_EXCEPTION_RESOLUTION_STATUSES = [
  "resolved",
  "waived",
] as const;
export type BoqExceptionResolutionStatus =
  (typeof BOQ_EXCEPTION_RESOLUTION_STATUSES)[number];

export interface BoqVerificationScope {
  organisationId: string;
  projectId: string;
  actorUserId: string | null;
}

export interface BoqRunDraft {
  documentId: string;
  lines: readonly BoqCommercialLine[];
  lots: readonly BoqLotSummary[];
}

export interface BoqExceptionResolutionDraft {
  status: BoqExceptionResolutionStatus;
  reason: string;
}

export interface BoqRunRecord {
  id: string;
  organisationId: string;
  projectId: string;
  documentVersionId: string;
  rulePackId: string;
  verifierVersion: string;
  workbookManifest: string;
  status: string;
  exceptionCount: number;
  passed: boolean;
  computedLotTotalsMinor: Record<string, string>;
  startedByUserId: string | null;
  startedAt: string;
  completedAt: string | null;
  version: number;
}

export interface BoqExceptionRecord {
  id: string;
  boqRunId: string;
  lotReference: string | null;
  cellReference: string | null;
  exceptionCode: BoqException["code"];
  severity: BoqException["severity"];
  expectedMinor: string | null;
  actualMinor: string | null;
  currency: string | null;
  finding: string;
  status: "open" | BoqExceptionResolutionStatus;
  resolutionReason: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  version: number;
}

export interface BoqVerificationSnapshot {
  organisationId: string;
  projectId: string;
  projectStatus: string;
  rulePackId: string;
  verifierVersion: string;
  runs: readonly BoqRunRecord[];
  openExceptionCount: number;
  generatedAt: string;
  authorityNote: string;
}

export interface BoqRunDetail {
  run: BoqRunRecord;
  exceptions: readonly BoqExceptionRecord[];
  authorityNote: string;
}

export type BoqRunOutcome =
  | { outcome: "created"; run: BoqRunRecord; exceptions: BoqExceptionRecord[] }
  | { outcome: "document_conflict" | "capacity_exceeded" };

export type BoqExceptionResolutionOutcome =
  | { outcome: "updated"; exception: BoqExceptionRecord }
  | { outcome: "not_found" | "version_conflict" | "state_conflict" };

export interface BoqVerificationRepository {
  readSnapshot(
    scope: BoqVerificationScope,
    now: Date,
  ): Promise<BoqVerificationSnapshot>;
  createRun(
    scope: BoqVerificationScope,
    draft: BoqRunDraft,
    now: Date,
  ): Promise<BoqRunOutcome>;
  readRun(
    scope: BoqVerificationScope,
    runId: string,
  ): Promise<BoqRunDetail | null>;
  resolveException(
    scope: BoqVerificationScope,
    exceptionId: string,
    expectedVersion: number,
    draft: BoqExceptionResolutionDraft,
    now: Date,
  ): Promise<BoqExceptionResolutionOutcome>;
}

export class BoqVerificationRepositoryUnavailableError extends Error {
  constructor(message = "BOQ verification persistence is unavailable") {
    super(message);
    this.name = "BoqVerificationRepositoryUnavailableError";
  }
}

export class BoqVerificationProjectAccessError extends Error {
  constructor(public readonly code: "not_found" | "archived") {
    super(code);
    this.name = "BoqVerificationProjectAccessError";
  }
}
