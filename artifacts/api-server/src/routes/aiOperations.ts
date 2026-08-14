import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { desc, eq } from "drizzle-orm";
import { db, evaluationRuns, llmRuns } from "@workspace/db";
import {
  getAccessContext,
  getOrganisationId,
  type AccessContext,
} from "../middlewares/tenancy";
import type { OrganisationRole } from "../lib/permissions";
import {
  AI_CAPABILITY_POLICY,
  AI_SAFE_ERROR_CODES,
  productionCapabilityEnvironmentKey,
} from "../lib/aiPolicy";
import { maximumCapabilityReservationMinor } from "../lib/aiGateway";
import { AI_PROMPT_REGISTRY } from "../lib/aiPromptRegistry";
import {
  configuredAiExpectedVersions,
  configuredAiReleaseGateStatus,
  configuredAiRuntime,
} from "../lib/aiRuntime";
import { isExplicitTenantFeatureEnabled } from "../lib/featureFlags";
import { configuredModelAdapters } from "../lib/openAiModelAdapter";
import {
  hasVerifiedModelDataGovernance,
  type JsonModelAdapter,
} from "../lib/providerContracts";

const router: IRouter = Router();
const safeErrorCodes = new Set<string>(AI_SAFE_ERROR_CODES);
const INTERNAL_AI_OPERATIONS_ROLES = new Set<OrganisationRole>([
  "valo_operations_administrator",
  "valo_analyst",
  "valo_quality_adviser",
]);

export function canReadInternalAiOperations(
  context: AccessContext | undefined,
): boolean {
  return Boolean(
    context?.source === "membership" &&
    context.permissions.has("evaluation:read") &&
    context.roles.some((role) => INTERNAL_AI_OPERATIONS_ROLES.has(role)),
  );
}

export function requireInternalAiOperations(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!canReadInternalAiOperations(getAccessContext(req))) {
    res.status(403).json({ error: "Insufficient role" });
    return;
  }
  next();
}

export function aiOperationsBudgetBlocker(
  budget: ReturnType<typeof configuredAiRuntime>["budget"],
):
  | "AI_BUDGET_UNAVAILABLE"
  | "AI_BUDGET_CURRENCY_MISMATCH"
  | "AI_BUDGET_EXCEEDED"
  | null {
  if (!budget) return "AI_BUDGET_UNAVAILABLE";
  const capabilityBudgetCurrencies = new Set<string>(
    Object.values(AI_CAPABILITY_POLICY).map(
      (policy) => policy.limits.costCurrency,
    ),
  );
  if (!capabilityBudgetCurrencies.has(budget.currency))
    return "AI_BUDGET_CURRENCY_MISMATCH";
  if (budget.remainingMinor <= 0) return "AI_BUDGET_EXCEEDED";
  try {
    const atLeastOneCapabilityFits = Object.values(AI_CAPABILITY_POLICY).some(
      (policy) => {
        const reservation = maximumCapabilityReservationMinor(
          policy.id,
          budget,
        );
        return (
          reservation <= policy.limits.maxCostMinor &&
          reservation <= budget.remainingMinor
        );
      },
    );
    if (!atLeastOneCapabilityFits) return "AI_BUDGET_EXCEEDED";
  } catch {
    return "AI_BUDGET_UNAVAILABLE";
  }
  return null;
}

function providerSatisfiesRuntimePolicy(
  adapter: JsonModelAdapter,
  policy: ReturnType<typeof configuredAiRuntime>["providerPolicy"],
  environment: ReturnType<typeof configuredAiRuntime>["environment"],
): boolean {
  if (
    environment === "production" &&
    (adapter.descriptor.mode !== "production" ||
      adapter.descriptor.productionApproved !== true)
  ) {
    return false;
  }
  const governance = adapter.descriptor.dataGovernance;
  if (!governance || !hasVerifiedModelDataGovernance(adapter.descriptor)) {
    return false;
  }
  const requiredRegion = policy.requiredRegion.trim().toLowerCase();
  if (
    !requiredRegion ||
    policy.maxRetentionDays < 0 ||
    !governance.regions.includes(requiredRegion)
  ) {
    return false;
  }
  const retentionDays =
    governance.retentionMode === "zero"
      ? 0
      : (governance.maxRetentionDays ?? Number.POSITIVE_INFINITY);
  if (policy.requireZeroRetention && governance.retentionMode !== "zero") {
    return false;
  }
  return retentionDays <= policy.maxRetentionDays;
}

function providerSupportsRestrictedMode(
  adapter: JsonModelAdapter,
  policy: ReturnType<typeof configuredAiRuntime>["providerPolicy"],
  environment: ReturnType<typeof configuredAiRuntime>["environment"],
): boolean {
  return (
    providerSatisfiesRuntimePolicy(adapter, policy, environment) &&
    adapter.descriptor.dataGovernance?.restrictedModeEligible === true
  );
}

router.get(
  "/ai/operations",
  requireInternalAiOperations,
  async (req: Request, res: Response) => {
    const organisationId = getOrganisationId(req);
    if (!organisationId) {
      res.status(403).json({ error: "Active organisation required" });
      return;
    }
    const runtime = configuredAiRuntime();
    const releaseGate = await configuredAiReleaseGateStatus(runtime);
    const expectedVersions = await configuredAiExpectedVersions(runtime);
    const adapters = configuredModelAdapters();
    const capabilities = await Promise.all(
      Object.values(AI_CAPABILITY_POLICY).map(async (policy) => {
        const environmentApproved =
          process.env[productionCapabilityEnvironmentKey(policy.id)] === "true";
        const tenantEnabled = await isExplicitTenantFeatureEnabled(
          organisationId,
          `ai_${policy.id}`,
        );
        let budgetReservationFits = false;
        if (runtime.budget) {
          try {
            const reservation = maximumCapabilityReservationMinor(
              policy.id,
              runtime.budget,
            );
            budgetReservationFits =
              reservation <= policy.limits.maxCostMinor &&
              reservation <= runtime.budget.remainingMinor;
          } catch {
            budgetReservationFits = false;
          }
        }
        return {
          id: policy.id,
          autonomyLevel: policy.autonomyLevel,
          outputState: policy.approval.outputState,
          approvalAuthority: policy.approval.approvalAuthority,
          environmentApproved,
          tenantEnabled,
          activationGatesOpen:
            !runtime.globalKillSwitchEngaged &&
            budgetReservationFits &&
            (runtime.environment !== "production" ||
              (environmentApproved && tenantEnabled)),
          promptVersion: AI_PROMPT_REGISTRY[policy.id].promptVersion,
          promptHash: AI_PROMPT_REGISTRY[policy.id].promptHash,
          schemaVersion: AI_PROMPT_REGISTRY[policy.id].schemaVersion,
          schemaHash: AI_PROMPT_REGISTRY[policy.id].schemaHash,
          limits: policy.limits,
        };
      }),
    );
    const [recentRuns, evaluations, adapterHealth] = await Promise.all([
      db
        .select({
          id: llmRuns.id,
          projectId: llmRuns.projectId,
          task: llmRuns.task,
          model: llmRuns.model,
          promptVersion: llmRuns.promptVersion,
          promptTokens: llmRuns.promptTokens,
          completionTokens: llmRuns.completionTokens,
          error: llmRuns.error,
          createdAt: llmRuns.createdAt,
        })
        .from(llmRuns)
        .where(eq(llmRuns.organisationId, organisationId))
        .orderBy(desc(llmRuns.createdAt))
        .limit(20),
      db
        .select({
          id: evaluationRuns.id,
          task: evaluationRuns.task,
          corpusVersion: evaluationRuns.corpusVersion,
          status: evaluationRuns.status,
          sampleSize: evaluationRuns.sampleSize,
          releaseDecision: evaluationRuns.releaseDecision,
          startedAt: evaluationRuns.startedAt,
          completedAt: evaluationRuns.completedAt,
        })
        .from(evaluationRuns)
        .where(eq(evaluationRuns.organisationId, organisationId))
        .orderBy(desc(evaluationRuns.startedAt))
        .limit(10),
      Promise.all(
        adapters.map(async (adapter) => {
          try {
            return (await adapter.health()).healthy;
          } catch {
            return false;
          }
        }),
      ),
    ]);

    const blockers: string[] = [];
    if (runtime.globalKillSwitchEngaged) blockers.push("AI_GLOBAL_DISABLED");
    if (releaseGate.applicable && !releaseGate.allowed)
      blockers.push("AI_RELEASE_GATE_DENIED");
    if (
      runtime.environment === "production" &&
      (runtime.modelConfiguration.status !== "promoted" ||
        !runtime.modelConfiguration.evaluationApproved ||
        !runtime.modelConfiguration.configurationVersion)
    )
      blockers.push("AI_MODEL_CONFIGURATION_UNAVAILABLE");
    const budgetBlocker = aiOperationsBudgetBlocker(runtime.budget);
    if (budgetBlocker) blockers.push(budgetBlocker);
    const providerPrivacyReady = adapters.some((adapter) =>
      providerSatisfiesRuntimePolicy(
        adapter,
        runtime.providerPolicy,
        runtime.environment,
      ),
    );
    const restrictedModeSupported = adapters.some((adapter) =>
      providerSupportsRestrictedMode(
        adapter,
        runtime.providerPolicy,
        runtime.environment,
      ),
    );
    if (!providerPrivacyReady) blockers.push("AI_PROVIDER_PRIVACY_UNVERIFIED");
    const compatibleProviderHealthy = adapters.some(
      (adapter, index) =>
        adapterHealth[index] === true &&
        providerSatisfiesRuntimePolicy(
          adapter,
          runtime.providerPolicy,
          runtime.environment,
        ),
    );
    if (!compatibleProviderHealthy) blockers.push("AI_PROVIDER_UNAVAILABLE");
    if (!capabilities.some((capability) => capability.activationGatesOpen))
      blockers.push("AI_CAPABILITY_DISABLED");

    const uniqueBlockers = Array.from(new Set(blockers));
    const executionBlockers = uniqueBlockers.filter(
      (blocker) => blocker !== "AI_CAPABILITY_DISABLED",
    );

    res.json({
      generatedAt: new Date().toISOString(),
      environment: runtime.environment,
      productionAiEnabled:
        runtime.environment === "production" && uniqueBlockers.length === 0,
      globalKillSwitchEngaged: runtime.globalKillSwitchEngaged,
      modelConfiguration: {
        model: runtime.modelConfiguration.model,
        configurationVersion:
          runtime.modelConfiguration.configurationVersion || null,
        status: runtime.modelConfiguration.status,
        evaluationApproved: runtime.modelConfiguration.evaluationApproved,
      },
      budget: runtime.budget
        ? {
            currency: runtime.budget.currency,
            remainingMinor: runtime.budget.remainingMinor,
            rateCardVersion: runtime.budget.rateCardVersion,
          }
        : null,
      providerPolicy: {
        ...runtime.providerPolicy,
        restrictedModeSupported,
      },
      releaseGate: { ...releaseGate, expectedVersions },
      blockers: uniqueBlockers,
      capabilities: capabilities.map(
        ({ activationGatesOpen, ...capability }) => ({
          ...capability,
          effectiveEnabled:
            activationGatesOpen && executionBlockers.length === 0,
        }),
      ),
      recentRuns: recentRuns.map((run) => ({
        id: run.id,
        projectId: run.projectId,
        task: run.task,
        model: run.model,
        promptVersion: run.promptVersion,
        promptTokens: run.promptTokens,
        completionTokens: run.completionTokens,
        status: run.error ? "failed" : "succeeded",
        errorCode: run.error
          ? safeErrorCodes.has(run.error)
            ? run.error
            : "AI_LEGACY_ERROR_REDACTED"
          : null,
        createdAt: run.createdAt.toISOString(),
      })),
      evaluations: evaluations.map((run) => ({
        ...run,
        startedAt: run.startedAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
      })),
    });
  },
);

export default router;
