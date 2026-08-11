export type ConsortiumErrorCode =
  | "invalid_request"
  | "not_found"
  | "scope_denied"
  | "relationship_inactive"
  | "policy_denied"
  | "stale_version"
  | "conflict"
  | "capacity_exceeded";

export class ConsortiumError extends Error {
  constructor(
    readonly code: ConsortiumErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConsortiumError";
  }
}

export function consortiumHttpStatus(error: ConsortiumError): number {
  switch (error.code) {
    case "invalid_request":
      return 400;
    case "scope_denied":
      return 403;
    case "not_found":
      return 404;
    case "relationship_inactive":
    case "conflict":
    case "stale_version":
      return 409;
    case "capacity_exceeded":
      return 413;
    case "policy_denied":
      return 422;
  }
}
