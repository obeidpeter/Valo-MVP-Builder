import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyHostsFromOrigins,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { dedupeClerkCookies } from "./middlewares/dedupeClerkCookies";
import {
  createRateLimiter,
  parseAllowedOrigins,
  securityHeaders,
} from "./middlewares/security";
import { registerProductionWebApp } from "./lib/webApp";
import { createPublicBidAutopsyRouter } from "./routes/public";
import healthRouter from "./routes/health";
import { operationalSignals, requestCorrelationId } from "./lib/observability";

const app: Express = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    genReqId(req, res) {
      const requestId = requestCorrelationId(req.headers);
      res.setHeader("X-Request-Id", requestId);
      return requestId;
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(operationalSignals.middleware());

const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
const clerkProxyHosts = clerkProxyHostsFromOrigins(allowedOrigins);

// The Clerk proxy streams raw bytes and must be mounted before body parsers.
// Its public host is selected only from the exact CORS origin allowlist.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware(clerkProxyHosts));

app.use(securityHeaders);
app.use(
  cors({
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "If-Match",
      "X-Request-Id",
      "X-Valo-Organisation-Id",
      "X-Valo-Break-Glass-Session",
    ],
    exposedHeaders: ["X-Request-Id"],
    origin(origin, callback) {
      // Server-to-server and same-origin requests do not carry Origin.
      if (!origin || allowedOrigins.has(origin.replace(/\/$/, ""))) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed"));
    },
  }),
);
const rejectDisallowedCorsOrigin: ErrorRequestHandler = (
  error,
  _req,
  res,
  next,
) => {
  if (error instanceof Error && error.message === "Origin not allowed") {
    res.status(403).json({ error: "Request could not be accepted" });
    return;
  }
  next(error);
};
app.use(rejectDisallowedCorsOrigin);

// Liveness remains dependency-free; readiness checks lifecycle and database.
// Both exact routes are independent of Clerk and request throttling so the
// deployment sidecar can probe through its internal Host header. Mounting the
// router here avoids any path-prefix bypass in protected middleware.
app.use("/api", healthRouter);

app.use(
  createRateLimiter({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 300),
  }),
);
app.use(
  "/api/public",
  createPublicBidAutopsyRouter({
    allowedOrigins,
    trustedProxyConfigured: process.env.TRUST_PROXY === "1",
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Collapse duplicated Clerk cookies (a Replit dev-preview quirk) to the freshest
// value before Clerk verifies the session — otherwise a lingering expired copy
// can shadow the valid token and yield a spurious 401.
app.use(dedupeClerkCookies);

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req, clerkProxyHosts) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  registerProductionWebApp(app);
}

export default app;
