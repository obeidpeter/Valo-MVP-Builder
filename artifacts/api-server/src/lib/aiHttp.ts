import type { Response } from "express";
import { AiGatewayError } from "./aiGateway";
import { ModelInputTooLargeError } from "./sourceGrounding";

export function aiGatewayHttpStatus(error: AiGatewayError): number {
  switch (error.code) {
    case "AI_INVALID_REQUEST":
    case "AI_INPUT_LIMIT_EXCEEDED":
      return 422;
    case "AI_BUDGET_EXCEEDED":
      return 429;
    case "AI_OUTPUT_SCHEMA_INVALID":
    case "AI_USAGE_UNAVAILABLE":
      return 502;
    case "AI_CANCELLED":
      return 499;
    default:
      return 503;
  }
}

/** Emit only the gateway's fixed safe message and code; never provider text. */
export function sendAiGatewayError(res: Response, error: unknown): boolean {
  if (error instanceof ModelInputTooLargeError) {
    res.status(422).json({
      error: error.message,
      code: error.code,
      actualChars: error.actualChars,
      maxChars: error.maxChars,
    });
    return true;
  }
  if (!(error instanceof AiGatewayError)) return false;
  res.status(aiGatewayHttpStatus(error)).json({
    error: error.message,
    code: error.code,
  });
  return true;
}
