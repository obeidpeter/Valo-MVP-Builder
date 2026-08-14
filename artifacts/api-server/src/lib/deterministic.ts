/**
 * Permanent re-export barrel for the deterministic engines.
 *
 * The implementation now lives in six domain modules (boqArithmetic,
 * riskScoring, expiryTelemetry, projectWorkflow, retentionPlanning,
 * gate0Metrics). This module path is cited by importers, docs and proof
 * scripts by name and is kept forever as a pure re-export surface.
 */
export {
  toKobo,
  mulToKobo,
  koboToNumber,
  koboToSafeNumber,
  wordsToKobo,
  wordsToNumber,
  runBoqChecks,
  type BoqCheckType,
  type BoqRow,
  type BoqFinding,
  type BoqRunResult,
} from "./boqArithmetic";
export {
  computeRisk,
  blockingSignOffDefects,
  DEFAULT_RISK_CONFIG,
  SIGN_OFF_BLOCKING_SEVERITIES,
  type Severity,
  type RiskBand,
  type RiskInput,
  type RiskResult,
  type RiskConfig,
} from "./riskScoring";
export {
  computeExpiry,
  type ExpiryBand,
  type ExpiryTelemetry,
} from "./expiryTelemetry";
export {
  paymentGateSatisfied,
  validateProjectTransition,
  computeSlaDueAt,
  computeRedTeamDueAt,
  type ProjectStatus,
  type SlaClass,
  type PaymentStatus,
  type ConflictStatus,
  type WorkflowGateInput,
  type WorkflowGateResult,
} from "./projectWorkflow";
export {
  planRetentionScan,
  RETENTION_ELIGIBLE_STATUSES,
  type RetentionScanProject,
  type RetentionScanInput,
  type RetentionScanCandidate,
} from "./retentionPlanning";
export {
  assembleGate0,
  GATE0_THRESHOLDS,
  type Gate0MetricKey,
  type Gate0Metric,
  type Gate0Readiness,
  type Gate0Input,
} from "./gate0Metrics";
