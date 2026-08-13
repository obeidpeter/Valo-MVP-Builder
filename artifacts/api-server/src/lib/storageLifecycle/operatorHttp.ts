import type { StorageLifecycleRepositoryError } from "./repository";

export const STORAGE_LIFECYCLE_UNAVAILABLE_RECEIPT = Object.freeze({
  error: "Storage lifecycle persistence is unavailable",
  code: "STORAGE_LIFECYCLE_PERSISTENCE_UNAVAILABLE",
  sideEffectsApplied: false,
} as const);

export function storageLifecycleErrorStatus(
  code: StorageLifecycleRepositoryError["code"],
): 400 | 404 | 409 | 503 {
  if (code === "persistence_unavailable") return 503;
  if (code === "not_found") return 404;
  if (code === "stale_version" || code === "invalid_state") return 409;
  return 400;
}
