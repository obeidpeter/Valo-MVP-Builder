export type OperationsSuiteErrorCode =
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "stale_version"
  | "scope_denied"
  | "capacity_exceeded"
  | "policy_denied";

export class OperationsSuiteError extends Error {
  readonly code: OperationsSuiteErrorCode;

  constructor(code: OperationsSuiteErrorCode, message: string) {
    super(message);
    this.name = "OperationsSuiteError";
    this.code = code;
  }
}

export function operationsSuiteHttpStatus(error: OperationsSuiteError): number {
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
