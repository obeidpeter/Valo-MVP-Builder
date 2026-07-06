/**
 * Pull the server's human-readable error message off a failed request.
 *
 * customFetch attaches the parsed JSON body as `err.data`, so a server
 * `{ error: "..." }` envelope beats the generic Error message; the fallback
 * is used only when neither is available.
 */
export function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown })?.data;
  const serverError =
    data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
      ? (data as { error: string }).error
      : undefined;
  if (serverError) return serverError;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
