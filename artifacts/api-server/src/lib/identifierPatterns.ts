/**
 * Shared identifier-shape patterns used by route and repository validation.
 *
 * UUID_PATTERN accepts RFC 9562 versions 1-8, while UUID_V1_5_PATTERN keeps
 * the stricter historical version 1-5 shape. Existing call sites were written
 * against one variant or the other on purpose — never swap the variant used
 * at a call site.
 */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const UUID_V1_5_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export { isUuid } from "./projectMutationPolicy";
