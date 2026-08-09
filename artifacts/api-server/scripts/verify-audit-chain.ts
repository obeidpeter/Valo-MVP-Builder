/**
 * Independently verifies active v2 chains and reassesses preserved v1 bytes.
 * Active and legacy heads/digests are mandatory external inputs; values stored
 * in the same database are never treated as their own authority.
 */
import { createHash } from "node:crypto";
import { assertRuntimeDatabaseSecurity, pool } from "@workspace/db";
import {
  AUDIT_GENESIS_HASH,
  assessLegacyAuditArchive,
  verifyAuditChain,
  type AuditChainHead,
  type AuditChainRow,
} from "../src/lib/auditChain";

const SHA256 = /^[0-9a-f]{64}$/;
const LEGACY_SOURCE_COMMIT = "b71adcec4a7060c0ce2192266c81d880c5e56277";

interface LegacyHead extends AuditChainHead {
  prevHash: string;
}

function parseHead(raw: string): AuditChainHead {
  const match = /^(\d+):([0-9a-f]{64})$/i.exec(raw.trim());
  if (!match) throw new Error("audit head must be <seq>:<64-hex>");
  return { seq: Number(match[1]), hash: match[2].toLowerCase() };
}

function parseLegacyHead(raw: string): LegacyHead {
  const match = /^(\d+):([0-9a-f]{64}):([0-9a-f]{64})$/i.exec(raw.trim());
  if (!match) {
    throw new Error("legacy head must be <seq>:<hash>:<prev-hash>");
  }
  return {
    seq: Number(match[1]),
    hash: match[2].toLowerCase(),
    prevHash: match[3].toLowerCase(),
  };
}

function scopedValues<T>(
  mapName: string,
  singleName: string,
  parse: (value: string) => T,
): Map<string, T> {
  const values = new Map<string, T>();
  const rawMap = process.env[mapName]?.trim();
  if (rawMap) {
    const parsed = JSON.parse(rawMap) as Record<string, string>;
    for (const [organisationId, value] of Object.entries(parsed)) {
      values.set(organisationId, parse(value));
    }
  }
  const rawSingle = process.env[singleName]?.trim();
  if (rawSingle) {
    const organisationId = process.env.AUDIT_ORGANISATION_ID?.trim();
    if (!organisationId) {
      throw new Error(`${singleName} requires AUDIT_ORGANISATION_ID`);
    }
    values.set(organisationId, parse(rawSingle));
  }
  return values;
}

function parseDigest(raw: string): string {
  const digest = raw.trim().toLowerCase();
  if (!SHA256.test(digest)) throw new Error("archive digest must be 64-hex");
  return digest;
}

function ranges(sequences: number[]): string {
  if (sequences.length === 0) return "";
  const sorted = [...sequences].sort((left, right) => left - right);
  const output: string[] = [];
  let start = sorted[0];
  let end = sorted[0];
  for (const sequence of sorted.slice(1)) {
    if (sequence === end + 1) {
      end = sequence;
      continue;
    }
    output.push(start === end ? String(start) : `${start}-${end}`);
    start = sequence;
    end = sequence;
  }
  output.push(start === end ? String(start) : `${start}-${end}`);
  return output.join(",");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface VerificationResult {
  activeOk: boolean;
  legacy: "none" | "known_discontinuity" | "broken";
}

async function verifyOrganisation(
  organisationId: string,
  expectedActiveHead: AuditChainHead | undefined,
  expectedLegacyHead: LegacyHead | undefined,
  expectedArchiveDigest: string | undefined,
): Promise<VerificationResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query(
      "SELECT valo_security.set_current_organisation_id($1::uuid)",
      [organisationId],
    );
    const [activeResult, archiveResult, assessmentResult, archiveExport] =
      await Promise.all([
        client.query(
          `
          SELECT organisation_id::text, user_id::text, user_name,
            project_id::text, event_type, object_type, object_id, details,
            seq, prev_hash, hash, hash_version, row_no::text,
            to_char(created_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
          FROM public.audit_events
          WHERE organisation_id=$1::uuid
          ORDER BY seq
        `,
          [organisationId],
        ),
        client.query(
          `
          SELECT id::text, organisation_id::text, assessment_id::text,
            user_id::text, user_name, project_id::text, event_type,
            object_type, object_id, details, seq, prev_hash, hash,
            row_no::text, integrity_status,
            to_char(created_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
          FROM public.legacy_audit_events
          WHERE organisation_id=$1::uuid
          ORDER BY seq
        `,
          [organisationId],
        ),
        client.query(
          `
          SELECT id::text, organisation_id::text, source_commit,
            source_event_count, verified_ranges, discontinuity_ranges,
            finding, external_head_seq, external_head_hash,
            source_backup_sha256, source_audit_export_sha256,
            rehearsal_evidence_sha256, archive_digest
          FROM public.legacy_audit_integrity_assessments
          WHERE organisation_id=$1::uuid
        `,
          [organisationId],
        ),
        client.query(
          `
          SELECT COALESCE(
            string_agg(row_to_json(source_row)::text, E'\\n'
              ORDER BY source_row.seq) || E'\\n', ''
          ) AS content
          FROM (
            SELECT id,user_id,user_name,project_id,event_type,object_type,
              object_id,details,seq,prev_hash,hash,row_no,created_at
            FROM public.legacy_audit_events
            WHERE organisation_id=$1::uuid
            ORDER BY seq
          ) AS source_row
        `,
          [organisationId],
        ),
      ]);
    await client.query("ROLLBACK");

    const activeRows: AuditChainRow[] = activeResult.rows.map((row) => ({
      seq: row.seq,
      organisationId: row.organisation_id,
      userId: row.user_id,
      userName: row.user_name,
      projectId: row.project_id,
      eventType: row.event_type,
      objectType: row.object_type,
      objectId: row.object_id,
      details: row.details,
      createdAt: row.created_at,
      hashVersion: row.hash_version,
      prevHash: row.prev_hash,
      hash: row.hash,
    }));
    let activeOk = true;
    if (!expectedActiveHead) {
      activeOk = false;
      console.error(
        `[${organisationId}] ACTIVE FAIL: external v2 head is required`,
      );
    } else if (activeRows.length === 0) {
      activeOk =
        expectedActiveHead.seq === 0 &&
        expectedActiveHead.hash === AUDIT_GENESIS_HASH;
      if (!activeOk) {
        console.error(
          `[${organisationId}] ACTIVE FAIL: expected empty-chain anchor`,
        );
      }
    } else {
      const active = verifyAuditChain(activeRows, expectedActiveHead);
      activeOk = active.ok;
      if (!active.ok) {
        console.error(
          `[${organisationId}] ACTIVE FAIL seq=${active.error?.seq}: ${active.error?.reason}`,
        );
      }
    }
    const activeHead = activeRows.at(-1);
    console.log(
      activeHead
        ? `[${organisationId}] ACTIVE V2 HEAD seq=${activeHead.seq} hash=${activeHead.hash}`
        : `[${organisationId}] ACTIVE V2 HEAD seq=0 hash=${AUDIT_GENESIS_HASH}`,
    );

    const archived = archiveResult.rows;
    const assessments = assessmentResult.rows;
    if (archived.length === 0 && assessments.length === 0) {
      const boundaryMarker = activeResult.rows.some(
        (row) => row.event_type === "audit.legacy_boundary_registered",
      );
      if (expectedLegacyHead || expectedArchiveDigest || boundaryMarker) {
        console.error(
          `[${organisationId}] LEGACY FAIL: expected archive/assessment is missing`,
        );
        return { activeOk, legacy: "broken" };
      }
      return { activeOk, legacy: "none" };
    }
    if (
      archived.length === 0 ||
      assessments.length !== 1 ||
      !expectedLegacyHead ||
      !expectedArchiveDigest
    ) {
      console.error(
        `[${organisationId}] LEGACY FAIL: archive requires exactly one assessment and external head/digest`,
      );
      return { activeOk, legacy: "broken" };
    }

    const assessment = assessments[0];
    const archiveRows: AuditChainRow[] = archived.map((row) => ({
      seq: row.seq,
      organisationId: row.organisation_id,
      userId: row.user_id,
      userName: row.user_name,
      projectId: row.project_id,
      eventType: row.event_type,
      objectType: row.object_type,
      objectId: row.object_id,
      details: row.details,
      createdAt: row.created_at,
      hashVersion: 1,
      prevHash: row.prev_hash,
      hash: row.hash,
    }));
    const reassessed = assessLegacyAuditArchive(
      archiveRows,
      expectedLegacyHead,
    );
    const mismatchSet = new Set(reassessed.hashMismatchSequences);
    const verifiedSequences = archiveRows
      .map((row) => row.seq)
      .filter((sequence) => !mismatchSet.has(sequence));
    const digest = sha256(archiveExport.rows[0]?.content ?? "");
    const tail = archived.at(-1);
    const boundary = activeResult.rows.find((row) => row.seq === 1);
    let boundaryDetails: Record<string, unknown> | undefined;
    try {
      boundaryDetails = boundary?.details
        ? (JSON.parse(boundary.details) as Record<string, unknown>)
        : undefined;
    } catch {
      boundaryDetails = undefined;
    }
    const externalHeadDetails = boundaryDetails?.externalHead as
      | Record<string, unknown>
      | undefined;
    const classificationMatches = archived.every(
      (row) =>
        row.assessment_id === assessment.id &&
        row.integrity_status ===
          (mismatchSet.has(row.seq)
            ? "known_discontinuity"
            : "payload_hash_verified"),
    );
    const assessmentMatches =
      assessment.organisation_id === organisationId &&
      assessment.source_commit === LEGACY_SOURCE_COMMIT &&
      assessment.source_event_count === archived.length &&
      assessment.verified_ranges === ranges(verifiedSequences) &&
      assessment.discontinuity_ranges ===
        ranges(reassessed.hashMismatchSequences) &&
      String(assessment.finding).startsWith("KNOWN_DISCONTINUITY:") &&
      assessment.external_head_seq === expectedLegacyHead.seq &&
      assessment.external_head_hash === expectedLegacyHead.hash &&
      assessment.archive_digest === expectedArchiveDigest &&
      assessment.source_audit_export_sha256 === expectedArchiveDigest &&
      SHA256.test(assessment.source_backup_sha256) &&
      SHA256.test(assessment.rehearsal_evidence_sha256);
    const boundaryMatches =
      boundary?.organisation_id === organisationId &&
      boundary?.event_type === "audit.legacy_boundary_registered" &&
      boundary?.object_type === "legacy_audit_integrity_assessment" &&
      boundary?.object_id === assessment.id &&
      boundary?.prev_hash === AUDIT_GENESIS_HASH &&
      Number(boundary?.row_no) > Number(tail?.row_no) &&
      boundaryDetails?.integrityStatus === "KNOWN_DISCONTINUITY" &&
      boundaryDetails?.legacyAssessmentId === assessment.id &&
      boundaryDetails?.sourceCommit === LEGACY_SOURCE_COMMIT &&
      boundaryDetails?.sourceEventCount === archived.length &&
      JSON.stringify(boundaryDetails?.verifiedRanges) ===
        JSON.stringify(ranges(verifiedSequences).split(",")) &&
      JSON.stringify(boundaryDetails?.discontinuityRanges) ===
        JSON.stringify(ranges(reassessed.hashMismatchSequences).split(",")) &&
      boundaryDetails?.archiveDigest === expectedArchiveDigest &&
      boundaryDetails?.sourceBackupSha256 === assessment.source_backup_sha256 &&
      boundaryDetails?.sourceAuditExportSha256 === expectedArchiveDigest &&
      boundaryDetails?.rehearsalEvidenceSha256 ===
        assessment.rehearsal_evidence_sha256 &&
      externalHeadDetails?.seq === expectedLegacyHead.seq &&
      externalHeadDetails?.hash === expectedLegacyHead.hash &&
      externalHeadDetails?.prevHash === expectedLegacyHead.prevHash;
    const archiveMatches =
      reassessed.status === "known_discontinuity" &&
      classificationMatches &&
      assessmentMatches &&
      boundaryMatches &&
      digest === expectedArchiveDigest &&
      tail?.seq === expectedLegacyHead.seq &&
      tail?.hash === expectedLegacyHead.hash &&
      tail?.prev_hash === expectedLegacyHead.prevHash;
    if (!archiveMatches) {
      console.error(
        `[${organisationId}] LEGACY FAIL: preserved bytes/assessment/boundary differ from external evidence`,
      );
      return { activeOk, legacy: "broken" };
    }
    console.warn(
      `[${organisationId}] LEGACY V1 ARCHIVE: KNOWN DISCONTINUITY (preserved); mismatches=${ranges(reassessed.hashMismatchSequences)}`,
    );
    return { activeOk, legacy: "known_discontinuity" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<number> {
  await assertRuntimeDatabaseSecurity();
  const requestedOrganisationId = process.env.AUDIT_ORGANISATION_ID?.trim();
  const tenantRows = requestedOrganisationId
    ? (
        await pool.query<{ id: string }>(
          "SELECT id::text FROM organisations WHERE id=$1::uuid",
          [requestedOrganisationId],
        )
      ).rows
    : (await pool.query<{ id: string }>("SELECT id::text FROM organisations"))
        .rows;
  if (requestedOrganisationId && tenantRows.length !== 1) {
    throw new Error("AUDIT_ORGANISATION_ID does not identify an organisation");
  }
  const activeHeads = scopedValues(
    "AUDIT_EXPECTED_HEADS",
    "AUDIT_EXPECTED_HEAD",
    parseHead,
  );
  const legacyHeads = scopedValues(
    "AUDIT_EXPECTED_LEGACY_HEADS",
    "AUDIT_EXPECTED_LEGACY_HEAD",
    parseLegacyHead,
  );
  const archiveDigests = scopedValues(
    "AUDIT_EXPECTED_LEGACY_ARCHIVE_SHA256S",
    "AUDIT_EXPECTED_LEGACY_ARCHIVE_SHA256",
    parseDigest,
  );
  let activeOk = true;
  let legacyBroken = false;
  let knownLegacyCount = 0;
  for (const tenant of tenantRows) {
    const result = await verifyOrganisation(
      tenant.id,
      activeHeads.get(tenant.id),
      legacyHeads.get(tenant.id),
      archiveDigests.get(tenant.id),
    );
    activeOk = activeOk && result.activeOk;
    legacyBroken = legacyBroken || result.legacy === "broken";
    if (result.legacy === "known_discontinuity") knownLegacyCount += 1;
  }
  console.log(
    activeOk ? "ACTIVE V2 CHAINS: INTACT" : "ACTIVE V2 CHAINS: BROKEN",
  );
  if (legacyBroken) {
    console.error("LEGACY V1 ARCHIVES: BROKEN OR UNACKNOWLEDGED");
  } else if (knownLegacyCount > 0) {
    console.warn(
      `LEGACY V1 ARCHIVES: KNOWN DISCONTINUITY (preserved) tenants=${knownLegacyCount}`,
    );
  } else {
    console.log("LEGACY V1 ARCHIVES: NONE");
  }
  return activeOk && !legacyBroken ? 0 : 1;
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    console.error("verify-audit-chain crashed:", error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
