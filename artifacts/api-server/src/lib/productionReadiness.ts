import { OpenAiJsonModelAdapter } from "./openAiModelAdapter";
import type {
  AdapterDescriptor,
  AdapterKind,
  AdapterReadinessIssue,
} from "./providerContracts";
import { evaluateProductionAdapters } from "./providerContracts";
import { describedMalwareAdapters } from "./malwareScanner";

export type ProductionFeature = "document_intake" | "model_workflows";

const BASELINE_PRODUCTION_ADAPTERS: readonly AdapterKind[] = ["authentication"];

const ADAPTER_KINDS = new Set<AdapterKind>([
  "authentication",
  "object_storage",
  "malware_scan",
  "ocr",
  "model",
  "email",
  "whatsapp_business",
  "payment",
  "licensed_tender_feed",
  "audit_anchor",
]);

const FEATURE_REQUIREMENTS: Record<ProductionFeature, AdapterKind[]> = {
  document_intake: ["object_storage", "malware_scan"],
  model_workflows: ["model"],
};

export interface ProductionReadinessSnapshot {
  strictIssues: AdapterReadinessIssue[];
  featureIssues: Record<ProductionFeature, AdapterReadinessIssue[]>;
}

export function buildProductionReadinessSnapshot(
  requiredKinds: AdapterKind[],
  adapters: AdapterDescriptor[],
): ProductionReadinessSnapshot {
  return {
    strictIssues: evaluateProductionAdapters(requiredKinds, adapters),
    featureIssues: {
      document_intake: evaluateProductionAdapters(
        FEATURE_REQUIREMENTS.document_intake,
        adapters,
      ),
      model_workflows: evaluateProductionAdapters(
        FEATURE_REQUIREMENTS.model_workflows,
        adapters,
      ),
    },
  };
}

export function declaredRequiredProductionAdapterKinds(
  raw: string | undefined,
): AdapterKind[] {
  if (!raw?.trim()) return [...BASELINE_PRODUCTION_ADAPTERS];
  const values = Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  const invalid = values.filter(
    (value): value is string => !ADAPTER_KINDS.has(value as AdapterKind),
  );
  if (invalid.length > 0) {
    throw new Error(
      `VALO_REQUIRED_PRODUCTION_ADAPTERS contains unknown kinds: ${invalid.join(", ")}`,
    );
  }
  return Array.from(
    new Set([...BASELINE_PRODUCTION_ADAPTERS, ...(values as AdapterKind[])]),
  );
}

function infrastructureDescriptors(): AdapterDescriptor[] {
  const production = process.env.NODE_ENV === "production";
  const descriptors: AdapterDescriptor[] = [];
  if (
    process.env.CLERK_SECRET_KEY?.trim() &&
    process.env.CLERK_PUBLISHABLE_KEY?.trim()
  ) {
    descriptors.push({
      kind: "authentication",
      provider: "clerk",
      mode: production ? "production" : "development",
      productionApproved:
        process.env.CLERK_ADAPTER_PRODUCTION_APPROVED === "true",
      capabilities: ["session_verification", "identity_lookup"],
    });
  }
  if (process.env.PRIVATE_OBJECT_DIR?.trim()) {
    descriptors.push({
      kind: "object_storage",
      provider: "replit-object-storage",
      mode: production ? "production" : "development",
      productionApproved:
        process.env.OBJECT_STORAGE_ADAPTER_PRODUCTION_APPROVED === "true",
      capabilities: ["bounded_streaming", "tenant_namespace", "signed_put"],
    });
  }
  return descriptors;
}

export function configuredAdapterDescriptors(): AdapterDescriptor[] {
  return [
    ...infrastructureDescriptors(),
    new OpenAiJsonModelAdapter().descriptor,
    ...describedMalwareAdapters().map((adapter) => adapter.descriptor),
  ];
}

let currentSnapshot: ProductionReadinessSnapshot = {
  strictIssues: [],
  featureIssues: { document_intake: [], model_workflows: [] },
};

/**
 * Evaluate production adapters before the socket opens. Globally declared
 * requirements abort startup; feature-specific gaps are retained so only the
 * affected actions fail closed while health and remediation routes stay up.
 */
export function initializeProductionAdapterReadiness(): ProductionReadinessSnapshot {
  if (process.env.NODE_ENV !== "production") {
    currentSnapshot = {
      strictIssues: [],
      featureIssues: { document_intake: [], model_workflows: [] },
    };
    return currentSnapshot;
  }
  currentSnapshot = buildProductionReadinessSnapshot(
    declaredRequiredProductionAdapterKinds(
      process.env.VALO_REQUIRED_PRODUCTION_ADAPTERS,
    ),
    configuredAdapterDescriptors(),
  );
  if (currentSnapshot.strictIssues.length > 0) {
    throw new Error(
      `Production adapter readiness failed: ${currentSnapshot.strictIssues
        .map((issue) => `${issue.kind}/${issue.code}`)
        .join(", ")}`,
    );
  }
  return currentSnapshot;
}

export function productionFeatureIssues(
  feature: ProductionFeature,
): AdapterReadinessIssue[] {
  return currentSnapshot.featureIssues[feature];
}
