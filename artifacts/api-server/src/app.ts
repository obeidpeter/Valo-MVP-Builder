import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { dedupeClerkCookies } from "./middlewares/dedupeClerkCookies";
import {
  createRateLimiter,
  parseAllowedOrigins,
  securityHeaders,
} from "./middlewares/security";

const app: Express = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
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

// The Clerk proxy streams raw bytes and must be mounted before body parsers.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
app.use(securityHeaders);
app.use(
  cors({
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "If-Match",
      "X-Valo-Organisation-Id",
      "X-Valo-Break-Glass-Session",
    ],
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
app.use(
  createRateLimiter({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 300),
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
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
