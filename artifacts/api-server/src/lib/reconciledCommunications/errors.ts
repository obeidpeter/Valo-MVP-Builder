export type CommunicationErrorCode =
  | "invalid_request"
  | "not_found"
  | "scope_denied"
  | "policy_denied"
  | "stale_version"
  | "conflict"
  | "capacity_exceeded"
  | "provider_disconnected"
  | "receipt_unverified";

export class CommunicationError extends Error {
  constructor(
    readonly code: CommunicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CommunicationError";
  }
}

export function communicationHttpStatus(error: CommunicationError): number {
  switch (error.code) {
    case "invalid_request":
      return 400;
    case "scope_denied":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
    case "stale_version":
      return 409;
    case "capacity_exceeded":
      return 413;
    case "provider_disconnected":
      return 503;
    case "receipt_unverified":
    case "policy_denied":
      return 422;
  }
}
