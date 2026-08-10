CREATE SCHEMA "valo_intake";
--> statement-breakpoint
CREATE TABLE "valo_intake"."bid_autopsy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"payload_fingerprint" text NOT NULL,
	"contact_name" text NOT NULL,
	"company_name" text NOT NULL,
	"business_email" text NOT NULL,
	"business_telephone" text NOT NULL,
	"tender_category" text NOT NULL,
	"bid_stage" text NOT NULL,
	"tender_deadline" date,
	"preferred_contact_method" text NOT NULL,
	"privacy_notice_version" text NOT NULL,
	"destination" text DEFAULT 'database' NOT NULL,
	"delivery_status" text DEFAULT 'stored' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bid_autopsy_requests_idempotency_unique" ON "valo_intake"."bid_autopsy_requests" USING btree ("idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "bid_autopsy_requests_delivery_received_idx" ON "valo_intake"."bid_autopsy_requests" USING btree ("delivery_status","received_at");
--> statement-breakpoint
ALTER TABLE "valo_intake"."bid_autopsy_requests"
  ADD CONSTRAINT "bid_autopsy_requests_idempotency_hash_check"
    CHECK ("idempotency_key_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "bid_autopsy_requests_payload_fingerprint_check"
    CHECK ("payload_fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "bid_autopsy_requests_contact_name_check"
    CHECK (char_length("contact_name") BETWEEN 2 AND 120 AND "contact_name" !~ '[[:cntrl:]]'),
  ADD CONSTRAINT "bid_autopsy_requests_company_name_check"
    CHECK (char_length("company_name") BETWEEN 2 AND 160 AND "company_name" !~ '[[:cntrl:]]'),
  ADD CONSTRAINT "bid_autopsy_requests_email_check"
    CHECK (char_length("business_email") BETWEEN 5 AND 254 AND "business_email" = lower("business_email") AND "business_email" !~ '[[:cntrl:]]'),
  ADD CONSTRAINT "bid_autopsy_requests_telephone_check"
    CHECK (char_length("business_telephone") BETWEEN 7 AND 32 AND "business_telephone" !~ '[[:cntrl:]]'),
  ADD CONSTRAINT "bid_autopsy_requests_category_check"
    CHECK ("tender_category" IN ('federal_public','oil_and_gas','donor_funded','other')),
  ADD CONSTRAINT "bid_autopsy_requests_stage_check"
    CHECK ("bid_stage" IN ('live','draft','previously_submitted')),
  ADD CONSTRAINT "bid_autopsy_requests_contact_method_check"
    CHECK ("preferred_contact_method" IN ('email','telephone')),
  ADD CONSTRAINT "bid_autopsy_requests_privacy_version_check"
    CHECK (char_length("privacy_notice_version") BETWEEN 1 AND 40),
  ADD CONSTRAINT "bid_autopsy_requests_destination_check"
    CHECK ("destination" = 'database'),
  ADD CONSTRAINT "bid_autopsy_requests_delivery_status_check"
    CHECK ("delivery_status" IN ('stored','follow_up_started','closed'));
--> statement-breakpoint

-- Public intake contains pre-account PII and is not tenant data. The runtime
-- receives no direct table privileges: it may only execute the bounded,
-- parameterised idempotent insert function below. Monitoring and lifecycle
-- work require a separately authorised owner-side process.
REVOKE ALL ON SCHEMA "valo_intake" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "valo_intake"."bid_autopsy_requests" FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "valo_intake"."store_bid_autopsy_request"(
  p_idempotency_key_hash text,
  p_payload_fingerprint text,
  p_contact_name text,
  p_company_name text,
  p_business_email text,
  p_business_telephone text,
  p_tender_category text,
  p_bid_stage text,
  p_tender_deadline date,
  p_preferred_contact_method text,
  p_privacy_notice_version text
)
RETURNS TABLE (
  request_id uuid,
  received_at timestamptz,
  replayed boolean,
  payload_matches boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  INSERT INTO valo_intake.bid_autopsy_requests AS inserted (
    idempotency_key_hash,
    payload_fingerprint,
    contact_name,
    company_name,
    business_email,
    business_telephone,
    tender_category,
    bid_stage,
    tender_deadline,
    preferred_contact_method,
    privacy_notice_version
  ) VALUES (
    p_idempotency_key_hash,
    p_payload_fingerprint,
    p_contact_name,
    p_company_name,
    p_business_email,
    p_business_telephone,
    p_tender_category,
    p_bid_stage,
    p_tender_deadline,
    p_preferred_contact_method,
    p_privacy_notice_version
  )
  ON CONFLICT (idempotency_key_hash) DO NOTHING
  RETURNING inserted.id, inserted.received_at
  INTO request_id, received_at;

  IF FOUND THEN
    replayed := false;
    payload_matches := true;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT stored.id, stored.received_at,
    stored.payload_fingerprint = p_payload_fingerprint
  INTO request_id, received_at, payload_matches
  FROM valo_intake.bid_autopsy_requests AS stored
  WHERE stored.idempotency_key_hash = p_idempotency_key_hash;

  IF request_id IS NULL THEN
    RAISE EXCEPTION 'idempotent intake result unavailable';
  END IF;

  replayed := true;
  RETURN NEXT;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "valo_intake"."store_bid_autopsy_request"(
  text,text,text,text,text,text,text,text,date,text,text
) FROM PUBLIC;
--> statement-breakpoint

DO $runtime_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'valo_app_runtime') THEN
    GRANT USAGE ON SCHEMA "valo_intake" TO valo_app_runtime;
    GRANT EXECUTE ON FUNCTION "valo_intake"."store_bid_autopsy_request"(
      text,text,text,text,text,text,text,text,date,text,text
    ) TO valo_app_runtime;
  END IF;
END;
$runtime_grant$;
