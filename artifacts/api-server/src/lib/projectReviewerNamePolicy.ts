const FORBIDDEN_NAME_CODE_UNIT = /[\u0000-\u001f\u007f\ud800-\udfff]/u;

export function validProjectReviewerName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim() &&
    !FORBIDDEN_NAME_CODE_UNIT.test(value)
  );
}
