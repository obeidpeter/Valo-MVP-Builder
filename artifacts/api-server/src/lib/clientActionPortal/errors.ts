export type ClientActionErrorCode =
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "stale_version"
  | "scope_denied"
  | "capacity_exceeded"
  | "policy_denied";

export class ClientActionError extends Error {
  constructor(
    readonly code: ClientActionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ClientActionError";
  }
}

export function clientActionHttpStatus(error: ClientActionError): number {
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
    case "policy_denied":
      return 422;
  }
}
