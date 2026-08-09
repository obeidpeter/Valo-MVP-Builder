export * from "./generated/api";
export * from "./generated/api.schemas";
export {
  customFetch,
  setBaseUrl,
  setAuthTokenGetter,
  setRequestContextGetter,
} from "./custom-fetch";
export type {
  AuthTokenGetter,
  RequestContext,
  RequestContextGetter,
} from "./custom-fetch";
