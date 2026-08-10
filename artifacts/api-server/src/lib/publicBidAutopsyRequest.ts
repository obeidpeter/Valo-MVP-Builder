import { createHash, createHmac } from "node:crypto";
import { pool } from "@workspace/db";

export const PUBLIC_LEAD_DESTINATION = "database" as const;
export const PUBLIC_LEAD_PRIVACY_NOTICE_VERSION = "2026-08-10";

export type TenderCategory =
  | "federal_public"
  | "oil_and_gas"
  | "donor_funded"
  | "other";
export type BidStage = "live" | "draft" | "previously_submitted";
export type PreferredContactMethod = "email" | "telephone";

export interface NormalizedBidAutopsyRequest {
  contactName: string;
  companyName: string;
  businessEmail: string;
  businessTelephone: string;
  tenderCategory: TenderCategory;
  bidStage: BidStage;
  tenderDeadline: string | null;
  preferredContactMethod: PreferredContactMethod;
}

export interface StoredBidAutopsyRequest {
  requestId: string;
  acceptedAt: Date;
  replayed: boolean;
  payloadMatches: boolean;
}

export type BidAutopsyRequestStore = (
  idempotencyKey: string,
  request: NormalizedBidAutopsyRequest,
  retentionDays: number,
) => Promise<StoredBidAutopsyRequest>;

export interface BidAutopsyRateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export type BidAutopsyRateLimitConsumer = (
  clientKeyHash: string,
  windowSeconds: number,
  maxRequests: number,
) => Promise<BidAutopsyRateLimitDecision>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Pseudonymises the client address before it crosses the database boundary.
 * The versioned scope prevents this digest from being correlated with any
 * future HMAC use that shares the same server-only secret.
 */
export function bidAutopsyRateLimitClientKey(
  clientAddress: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update("valo:public:bid-autopsy-rate-limit:v1\0", "utf8")
    .update(clientAddress, "utf8")
    .digest("hex");
}

/** The stable business payload only; anti-bot timing is intentionally absent. */
export function bidAutopsyPayloadFingerprint(
  request: NormalizedBidAutopsyRequest,
): string {
  return sha256(
    JSON.stringify([
      request.contactName,
      request.companyName,
      request.businessEmail,
      request.businessTelephone,
      request.tenderCategory,
      request.bidStage,
      request.tenderDeadline,
      request.preferredContactMethod,
    ]),
  );
}

interface StoredBidAutopsyRequestRow {
  request_id: string;
  received_at: Date;
  replayed: boolean;
  payload_matches: boolean;
}

/**
 * Calls the least-privilege database function. The production runtime cannot
 * select, update or delete the underlying pre-account PII table directly.
 */
export const storeBidAutopsyRequest: BidAutopsyRequestStore = async (
  idempotencyKey,
  request,
  retentionDays,
) => {
  const result = await pool.query<StoredBidAutopsyRequestRow>(
    `SELECT request_id, received_at, replayed, payload_matches
     FROM valo_intake.store_bid_autopsy_request(
       $1::text,$2::text,$3::text,$4::text,$5::text,$6::text,
       $7::text,$8::text,$9::date,$10::text,$11::text,$12::integer
     )`,
    [
      sha256(idempotencyKey),
      bidAutopsyPayloadFingerprint(request),
      request.contactName,
      request.companyName,
      request.businessEmail,
      request.businessTelephone,
      request.tenderCategory,
      request.bidStage,
      request.tenderDeadline,
      request.preferredContactMethod,
      PUBLIC_LEAD_PRIVACY_NOTICE_VERSION,
      retentionDays,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Public intake did not return a receipt");
  return {
    requestId: row.request_id,
    acceptedAt: row.received_at,
    replayed: row.replayed,
    payloadMatches: row.payload_matches,
  };
};

interface BidAutopsyRateLimitRow {
  allowed: boolean;
  remaining: number;
  reset_at: Date;
}

/**
 * Consumes one shared database bucket. The least-privilege production role can
 * execute this bounded function but cannot read or mutate the bucket table.
 */
export const consumeBidAutopsyRateLimit: BidAutopsyRateLimitConsumer = async (
  clientKeyHash,
  windowSeconds,
  maxRequests,
) => {
  const result = await pool.query<BidAutopsyRateLimitRow>(
    `SELECT allowed, remaining, reset_at
     FROM valo_intake.consume_bid_autopsy_rate_limit(
       $1::text,$2::integer,$3::integer
     )`,
    [clientKeyHash, windowSeconds, maxRequests],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Public intake rate limit returned no decision");
  return {
    allowed: row.allowed,
    remaining: row.remaining,
    resetAt: row.reset_at,
  };
};
