/**
 * The deployed retrieval/index registry — the production identity source for
 * the AI release gate's retrieval and index versions.
 *
 * Production retrieval and index versions must come from a deployed,
 * isolation-attested registry whose live identity can be recomputed, never
 * from operator-authored labels. This module is the single source of truth
 * for that decision: it names the exact deployment demands the registry
 * proves, defines the canonical retrieval and corpus-index definitions in
 * code, and recomputes the registered identity from the deployed database on
 * every attestation call. It deliberately offers no environment-variable,
 * file, or configuration escape hatch: the only inputs are this source and
 * the deployed registry table, so availability can never be asserted from
 * outside a reviewed code change.
 *
 * Registration (below) writes only code-derived rows; the attestation then
 * proves, live, that the deployed rows still recompute to the code-side
 * identity and that the corpus source tables keep their FORCE-RLS posture.
 */

import { and, eq, sql } from "drizzle-orm";
import {
  aiRetrievalRegistry as aiRetrievalRegistryTable,
  db,
} from "@workspace/db";
import { canonicalJson, sha256 } from "./aiPromptRegistry";
import { MAX_COMPLETE_MODEL_INPUT_CHARS } from "./sourceGrounding";

export const RETRIEVAL_REGISTRY_BLOCKER =
  "retrieval_registry_unavailable" as const;

export interface RetrievalRegistryRequirement {
  code: string;
  description: string;
}

export const AI_RETRIEVAL_REGISTRY_REQUIREMENTS: readonly RetrievalRegistryRequirement[] =
  Object.freeze([
    Object.freeze({
      code: "registry_deployment_absent",
      description:
        "A registry service or table must exist in the deployed environment " +
        "holding the live retrieval and index version identities.",
    }),
    Object.freeze({
      code: "tenant_isolation_unattested",
      description:
        "The registry's storage must carry the same tenant-isolation posture " +
        "as the rest of the system (FORCE RLS or equivalent), verified by " +
        "startup attestation, so retrieval context can never cross tenants.",
    }),
    Object.freeze({
      code: "content_digest_attestation_absent",
      description:
        "Each registered retrieval corpus and index must be content-addressed " +
        "(SHA-256) so the release gate can compare the live identity against " +
        "the retained evidence bundle, not a label.",
    }),
    Object.freeze({
      code: "version_identity_recomputation_absent",
      description:
        "The runtime must recompute the registry identity at gate-evaluation " +
        "time from the deployed registry itself; a boot-time snapshot or " +
        "cached value is not an attestation.",
    }),
  ]);

export type RetrievalRegistryAttestation =
  | {
      available: false;
      blocker: typeof RETRIEVAL_REGISTRY_BLOCKER;
      unmetRequirements: readonly RetrievalRegistryRequirement[];
    }
  | {
      available: true;
      retrievalVersion: string;
      indexVersion: string;
      attestationSha256: string;
    };

const REGISTRY_DEFINITION_SCHEMA = "valo.ai-retrieval-definition/v1";
const REGISTRY_ATTESTATION_SCHEMA = "valo.ai-retrieval-attestation/v1";

/**
 * The tenant tables the deployed complete-corpus pipeline reads its context
 * from. Their FORCE-RLS posture is recomputed live from pg_catalog on every
 * attestation, so a policy regression flips the gate closed on the next
 * evaluation rather than at the next deploy.
 */
export const AI_CORPUS_SOURCE_TABLES = Object.freeze([
  "document_versions",
  "documents",
  "projects",
] as const);

/**
 * Canonical definition of the deployed retrieval behaviour. The production
 * pipeline sends the complete selected corpus to the model or fails closed;
 * nothing is sampled, truncated, chunked, embedded, reranked, or cached.
 * Changing any of these facts changes the content digest, and therefore the
 * registered version identity the release gate compares evidence against.
 */
export const DEPLOYED_RETRIEVAL_DEFINITION = Object.freeze({
  schema: REGISTRY_DEFINITION_SCHEMA,
  component: "retrieval",
  family: "bounded-complete-corpus",
  completeCorpus: Object.freeze({
    maxInputCharacters: MAX_COMPLETE_MODEL_INPUT_CHARS,
    oversizeBehaviour: "fail_closed",
    truncation: "forbidden",
    quoteGrounding: "verbatim-normalised-source-check",
  }),
  augmentation: Object.freeze({
    embeddingModel: null,
    vectorIndex: null,
    reranker: null,
    retrievalCache: null,
  }),
});

/**
 * Canonical definition of the deployed corpus assembly ("index" in release
 * gate terms). The corpus is the tenant's governed document set: content
 * addressed by SHA-256, bound to current cleared document versions, and read
 * exclusively through FORCE-RLS tenant tables.
 */
export const DEPLOYED_CORPUS_INDEX_DEFINITION = Object.freeze({
  schema: REGISTRY_DEFINITION_SCHEMA,
  component: "index",
  family: "tenant-cleared-document-corpus",
  selection: Object.freeze({
    sourceTables: AI_CORPUS_SOURCE_TABLES,
    versionBinding: "current-cleared-document-version",
    contentAddressing: "sha256",
    tenantScope: "force-rls",
  }),
});

interface RegistryEntryIdentity {
  component: "retrieval" | "index";
  canonicalDefinition: string;
  contentSha256: string;
  version: string;
}

function componentVersion(family: string, contentSha256: string): string {
  return `${family}.v1.${contentSha256.slice(0, 16)}`;
}

/** The code-derived identities the deployed registry must recompute to. */
export function expectedRegistryEntries(): RegistryEntryIdentity[] {
  return [DEPLOYED_RETRIEVAL_DEFINITION, DEPLOYED_CORPUS_INDEX_DEFINITION].map(
    (definition) => {
      const canonicalDefinition = canonicalJson(definition);
      const contentSha256 = sha256(canonicalDefinition);
      return {
        component: definition.component as "retrieval" | "index",
        canonicalDefinition,
        contentSha256,
        version: componentVersion(definition.family, contentSha256),
      };
    },
  );
}

async function activeRegistryRows(): Promise<
  (typeof aiRetrievalRegistryTable.$inferSelect)[]
> {
  return db
    .select()
    .from(aiRetrievalRegistryTable)
    .where(eq(aiRetrievalRegistryTable.status, "active"));
}

interface CorpusIsolationPosture {
  verified: boolean;
  tables: { tableName: string; forceRls: boolean }[];
}

async function corpusIsolationPosture(): Promise<CorpusIsolationPosture> {
  const result = await db.execute(sql`
    SELECT relation.relname::text AS table_name,
      (relation.relrowsecurity AND relation.relforcerowsecurity) AS force_rls
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname IN ('document_versions', 'documents', 'projects')
  `);
  const byName = new Map(
    result.rows.map((row) => [String(row.table_name), row.force_rls === true]),
  );
  const tables = AI_CORPUS_SOURCE_TABLES.map((tableName) => ({
    tableName,
    forceRls: byName.get(tableName) === true,
  }));
  return { verified: tables.every((table) => table.forceRls), tables };
}

function requirementByCode(code: string): RetrievalRegistryRequirement {
  const requirement = AI_RETRIEVAL_REGISTRY_REQUIREMENTS.find(
    (candidate) => candidate.code === code,
  );
  if (!requirement) {
    throw new Error(`Unknown retrieval registry requirement: ${code}`);
  }
  return requirement;
}

function unavailable(
  unmetRequirements: readonly RetrievalRegistryRequirement[],
): RetrievalRegistryAttestation {
  return {
    available: false,
    blocker: RETRIEVAL_REGISTRY_BLOCKER,
    unmetRequirements,
  };
}

/**
 * Recomputes the deployed registry identity live. Every call queries the
 * registry table and pg_catalog afresh — no module state, no memoisation —
 * so a gate evaluation can never reuse a boot-time snapshot. Any query
 * failure, missing registration, digest mismatch, or isolation regression
 * fails closed to an unavailable attestation.
 */
export async function attestDeployedRetrievalRegistry(): Promise<RetrievalRegistryAttestation> {
  try {
    const expected = expectedRegistryEntries();
    const [rows, isolation] = await Promise.all([
      activeRegistryRows(),
      corpusIsolationPosture(),
    ]);
    const byComponent = new Map(rows.map((row) => [row.component, row]));
    const unmet: RetrievalRegistryRequirement[] = [];
    const deployed =
      rows.length === expected.length &&
      expected.every((entry) => byComponent.has(entry.component));
    if (!deployed) {
      unmet.push(requirementByCode("registry_deployment_absent"));
    }
    if (!isolation.verified) {
      unmet.push(requirementByCode("tenant_isolation_unattested"));
    }
    if (deployed) {
      const digestsAttested = expected.every((entry) => {
        const row = byComponent.get(entry.component);
        return (
          row !== undefined &&
          sha256(row.canonicalDefinition) === row.contentSha256 &&
          row.canonicalDefinition === entry.canonicalDefinition &&
          row.contentSha256 === entry.contentSha256 &&
          row.version === entry.version
        );
      });
      if (!digestsAttested) {
        unmet.push(requirementByCode("content_digest_attestation_absent"));
      }
    }
    if (unmet.length > 0) return unavailable(unmet);
    const retrieval = expected.find((entry) => entry.component === "retrieval");
    const index = expected.find((entry) => entry.component === "index");
    if (!retrieval || !index) {
      return unavailable(AI_RETRIEVAL_REGISTRY_REQUIREMENTS);
    }
    return {
      available: true,
      retrievalVersion: retrieval.version,
      indexVersion: index.version,
      attestationSha256: sha256(
        canonicalJson({
          schema: REGISTRY_ATTESTATION_SCHEMA,
          corpusIsolation: isolation.tables,
          entries: expected.map((entry) => ({
            component: entry.component,
            contentSha256: entry.contentSha256,
            version: entry.version,
          })),
        }),
      ),
    };
  } catch {
    // The deployed registry could not be recomputed at all, so every
    // deployment demand is unproven.
    return unavailable(AI_RETRIEVAL_REGISTRY_REQUIREMENTS);
  }
}

export interface RetrievalRegistryRegistration {
  changed: boolean;
  retrievalVersion: string;
  indexVersion: string;
}

/**
 * Registers the code-derived retrieval and corpus-index identities as the
 * active deployment rows, superseding any drifted predecessor. Registration
 * is idempotent, runs at deploy/startup after the database security
 * attestation, and derives every stored value from the definitions above, so
 * no caller input can influence the registered identity. History is
 * append-and-supersede: prior identities are never deleted.
 */
export async function registerDeployedRetrievalRegistry(): Promise<RetrievalRegistryRegistration> {
  const expected = expectedRegistryEntries();
  let changed = false;
  await db.transaction(async (transaction) => {
    const active = await transaction
      .select()
      .from(aiRetrievalRegistryTable)
      .where(eq(aiRetrievalRegistryTable.status, "active"));
    const byComponent = new Map(active.map((row) => [row.component, row]));
    for (const entry of expected) {
      const current = byComponent.get(entry.component);
      if (
        current &&
        current.canonicalDefinition === entry.canonicalDefinition &&
        current.contentSha256 === entry.contentSha256 &&
        current.version === entry.version
      ) {
        continue;
      }
      changed = true;
      if (current) {
        await transaction
          .update(aiRetrievalRegistryTable)
          .set({ status: "superseded", supersededAt: sql`now()` })
          .where(
            and(
              eq(aiRetrievalRegistryTable.id, current.id),
              eq(aiRetrievalRegistryTable.status, "active"),
            ),
          );
      }
      await transaction.insert(aiRetrievalRegistryTable).values({
        component: entry.component,
        version: entry.version,
        contentSha256: entry.contentSha256,
        canonicalDefinition: entry.canonicalDefinition,
      });
    }
  });
  const retrieval = expected.find((entry) => entry.component === "retrieval");
  const index = expected.find((entry) => entry.component === "index");
  if (!retrieval || !index) {
    throw new Error("Retrieval registry definitions are incomplete");
  }
  return {
    changed,
    retrievalVersion: retrieval.version,
    indexVersion: index.version,
  };
}
