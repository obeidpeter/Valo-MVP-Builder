export type IntakeFunctionManifestEntry = Readonly<{
  argumentCount: number;
  argumentTypes: string;
  identityArguments: string;
  returnType: string;
  functionResult: string;
  returnsSet: boolean;
  runtimeCanExecute: boolean;
  sourceSha256: string;
}>;

export const INTAKE_FUNCTION_MANIFEST: ReadonlyMap<
  string,
  IntakeFunctionManifestEntry
> = new Map([
  [
    "consume_bid_autopsy_rate_limit",
    {
      argumentCount: 3,
      argumentTypes: "text,integer,integer",
      identityArguments:
        "p_client_key_hash text, p_window_seconds integer, p_max_requests integer",
      returnType: "record",
      functionResult:
        "TABLE(allowed boolean, remaining integer, reset_at timestamp with time zone)",
      returnsSet: true,
      runtimeCanExecute: true,
      sourceSha256:
        "2b7bc1eedfc4de96716cb1bcaa71b75516d21416103f87b5ba5f8f0a8a04fcff",
    },
  ],
  [
    "get_bid_autopsy_contact_handoff",
    {
      argumentCount: 1,
      argumentTypes: "uuid",
      identityArguments: "p_request_id uuid",
      returnType: "record",
      functionResult:
        "TABLE(request_id uuid, contact_name text, preferred_contact_method text, contact_value text)",
      returnsSet: true,
      runtimeCanExecute: true,
      sourceSha256:
        "bb803997163ca8502955f5c1a71f13226a9d21d04935ce0139f9b1e63f6f4dbe",
    },
  ],
  [
    "list_bid_autopsy_work_queue",
    {
      argumentCount: 1,
      argumentTypes: "integer",
      identityArguments: "p_limit integer",
      returnType: "record",
      functionResult:
        "TABLE(request_id uuid, organisation_label text, tender_category text, bid_stage text, tender_deadline date, delivery_status text, received_at timestamp with time zone)",
      returnsSet: true,
      runtimeCanExecute: true,
      sourceSha256:
        "6750d49e15f7d6966b1bf3e24370e0d4001bdb7c18801900c379fafbfa4be4ca",
    },
  ],
  [
    "purge_expired_bid_autopsy_rate_limits",
    {
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "integer",
      functionResult: "integer",
      returnsSet: false,
      runtimeCanExecute: false,
      sourceSha256:
        "4ece097c1958c669ef9891640d65b8c61fc40d26c845841d0fc2ca03f2515df2",
    },
  ],
  [
    "purge_expired_bid_autopsy_requests",
    {
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "integer",
      functionResult: "integer",
      returnsSet: false,
      runtimeCanExecute: false,
      sourceSha256:
        "2d88ed14bbb8779f38b105983900eb47100c6771ce9e1fca29b9b4d93f58ff52",
    },
  ],
  [
    "store_bid_autopsy_request",
    {
      argumentCount: 12,
      argumentTypes:
        "text,text,text,text,text,text,text,text,date,text,text,integer",
      identityArguments:
        "p_idempotency_key_hash text, p_payload_fingerprint text, p_contact_name text, p_company_name text, p_business_email text, p_business_telephone text, p_tender_category text, p_bid_stage text, p_tender_deadline date, p_preferred_contact_method text, p_privacy_notice_version text, p_retention_days integer",
      returnType: "record",
      functionResult:
        "TABLE(request_id uuid, received_at timestamp with time zone, replayed boolean, payload_matches boolean)",
      returnsSet: true,
      runtimeCanExecute: true,
      sourceSha256:
        "d97eff1d25e172cec633476c0e28a04ead4004cf0e23e794a1c55e4afc7c0430",
    },
  ],
  [
    "transition_bid_autopsy_work_queue",
    {
      argumentCount: 3,
      argumentTypes: "uuid,text,text",
      identityArguments:
        "p_request_id uuid, p_expected_status text, p_next_status text",
      // PostgreSQL exposes the scalar OUT type for a one-column RETURNS TABLE.
      returnType: "uuid",
      functionResult: "TABLE(request_id uuid)",
      returnsSet: true,
      runtimeCanExecute: true,
      sourceSha256:
        "7a52e4670feb5f3c0a55dbfef8ebe1e6781a06f9cf3154e51fefb273f68af22b",
    },
  ],
]);
