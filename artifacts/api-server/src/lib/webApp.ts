import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";

const PUBLIC_SITE_ORIGIN = "https://valo-mvp-builder.replit.app";

interface PublicPageMetadata {
  title: string;
  description: string;
  heading: string;
}

const PUBLIC_WEB_PAGES: Readonly<Record<string, PublicPageMetadata>> = {
  "/": {
    title: "Valo | Evidence-led tender readiness",
    description:
      "Evidence-led tender controls for Nigerian public and regulated-market bids, with exact citations, deterministic checks and named human review.",
    heading: "Build a tender submission your team can defend.",
  },
  "/product": {
    title: "Product | Valo",
    description:
      "Explore Valo's evidence-led tender workspaces for intake, cited requirements, evidence, BOQ checks, issues, reports and audit.",
    heading: "A controlled workspace for evidence-heavy pursuits.",
  },
  "/solutions": {
    title: "Solutions | Valo",
    description:
      "Valo supports bid, compliance and advisory teams with source-backed tender workflows and controlled human review.",
    heading: "The same evidence record, shaped for each responsibility.",
  },
  "/how-it-works": {
    title: "How it works | Valo",
    description:
      "Follow Valo's controlled path from NDA-gated intake to cited requirements, evidence, review, approval and audit-ready release.",
    heading: "A review process with explicit gates.",
  },
  "/security": {
    title: "Security | Valo",
    description:
      "Understand Valo's tenant, input-security, provider-readiness, audit and human-authority controls.",
    heading: "Controls that are visible when they matter.",
  },
  "/about": {
    title: "About | Valo",
    description:
      "Valo is building an evidence-led tender operating system for Nigerian and regulated-market bid teams.",
    heading: "Better tender operations begin with a better record.",
  },
  "/contact": {
    title: "Contact | Valo",
    description:
      "Request a Valo walkthrough without sending tender documents through a public form.",
    heading: "Start with the workflow, not the tender file.",
  },
  "/privacy": {
    title: "Privacy | Valo",
    description:
      "How this Valo web experience handles public enquiries, account identity and tender-workspace information.",
    heading: "Privacy notice",
  },
  "/terms": {
    title: "Terms | Valo",
    description:
      "Plain-language boundaries for using the Valo public site and controlled tender workspace.",
    heading: "Service terms notice",
  },
};

const ACCESS_WEB_PATHS = new Set([
  "/sign-in",
  "/accept-invitation",
  "/sso-callback",
]);

const PROTECTED_WEB_PREFIXES = [
  "/app",
  "/dashboard",
  "/clients",
  "/projects",
  "/intelligence",
  "/sbd",
  "/operations",
  "/portal",
  "/partner",
  "/evidence-readiness",
  "/reports",
  "/billing",
  "/notifications",
  "/organisation-settings",
  "/settings",
  "/account",
] as const;

export const WEB_APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com",
  "connect-src 'self' https://clerk-telemetry.com https://*.clerk-telemetry.com https://*.protect.clerk.com",
  "img-src 'self' data: blob: https://img.clerk.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com",
  "manifest-src 'self'",
].join("; ");

function setWebAppHeaders(response: Response): void {
  response.setHeader(
    "Content-Security-Policy",
    WEB_APP_CONTENT_SECURITY_POLICY,
  );
}

export function isIndexablePublicWebPath(pathname: string): boolean {
  return PUBLIC_WEB_PAGES[pathname] !== undefined;
}

export function isApplicationWebPath(pathname: string): boolean {
  return (
    ACCESS_WEB_PATHS.has(pathname) ||
    PROTECTED_WEB_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function replaceNamedMeta(
  document: string,
  attribute: "name" | "property",
  key: string,
  content: string,
): string {
  const pattern = new RegExp(
    `<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*\\/?>`,
    "i",
  );
  return document.replace(
    pattern,
    `<meta ${attribute}="${key}" content="${escapeHtml(content)}" />`,
  );
}

function renderIndexDocument(indexTemplate: string, pathname: string): string {
  const page = PUBLIC_WEB_PAGES[pathname];
  const indexable = page !== undefined;
  const metadata = page ?? {
    title: isApplicationWebPath(pathname)
      ? "Secure workspace | Valo"
      : "Page not found | Valo",
    description: isApplicationWebPath(pathname)
      ? "Authorised access to the Valo tender workspace."
      : "The requested Valo page could not be found.",
    heading: "",
  };
  const canonicalUrl = `${PUBLIC_SITE_ORIGIN}${pathname === "/" ? "/" : pathname}`;

  let document = indexTemplate.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${escapeHtml(metadata.title)}</title>`,
  );
  document = replaceNamedMeta(
    document,
    "name",
    "description",
    metadata.description,
  );
  document = replaceNamedMeta(
    document,
    "name",
    "robots",
    indexable ? "index, follow" : "noindex, nofollow",
  );
  document = replaceNamedMeta(document, "property", "og:title", metadata.title);
  document = replaceNamedMeta(
    document,
    "property",
    "og:description",
    metadata.description,
  );
  document = replaceNamedMeta(
    document,
    "name",
    "twitter:title",
    metadata.title,
  );
  document = replaceNamedMeta(
    document,
    "name",
    "twitter:description",
    metadata.description,
  );

  if (indexable) {
    document = document.replace(
      /<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/i,
      `<link rel="canonical" href="${canonicalUrl}" />`,
    );
    document = replaceNamedMeta(document, "property", "og:url", canonicalUrl);
    const staticPublicContent = [
      '<div id="root">',
      '<main data-public-prerender="true">',
      '<nav aria-label="Public navigation">',
      '<a href="/">Valo home</a> ',
      '<a href="/product">Product</a> ',
      '<a href="/solutions">Solutions</a> ',
      '<a href="/how-it-works">How it works</a> ',
      '<a href="/security">Security</a> ',
      '<a href="/about">About</a> ',
      '<a href="/contact">Contact</a> ',
      '<a href="/sign-in">Sign in</a>',
      "</nav>",
      `<h1>${escapeHtml(metadata.heading)}</h1>`,
      `<p>${escapeHtml(metadata.description)}</p>`,
      "<p>Valo supports source-cited requirements, evidence-grounded actions, deterministic checks and named human review. It does not guarantee contract awards or invent credentials, claims or prices.</p>",
      "</main>",
      "</div>",
    ].join("");
    document = document.replace('<div id="root"></div>', staticPublicContent);
  } else {
    document = document
      .replace(/\s*<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/i, "")
      .replace(/\s*<meta\s+property="og:url"\s+content="[^"]*"\s*\/>/i, "");
  }

  return document;
}

export function registerProductionWebApp(
  app: Express,
  publicDirectory = path.resolve(
    import.meta.dirname,
    "../../valo-workbench/dist/public",
  ),
): void {
  const indexPath = path.join(publicDirectory, "index.html");

  if (!existsSync(indexPath)) {
    throw new Error(
      "Production workbench artifact is missing. Build @workspace/valo-workbench before starting the API.",
    );
  }
  const indexTemplate = readFileSync(indexPath, "utf8");

  app.use(
    express.static(publicDirectory, {
      index: false,
      setHeaders(response, filePath) {
        setWebAppHeaders(response);
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          response.setHeader(
            "Cache-Control",
            "public, max-age=31536000, immutable",
          );
        } else {
          response.setHeader("Cache-Control", "no-cache");
        }
        if (path.basename(filePath) === "index.html") {
          response.setHeader("X-Robots-Tag", "noindex, nofollow");
        }
      },
    }),
  );

  app.use((request: Request, response: Response, next: NextFunction): void => {
    if (
      (request.method !== "GET" && request.method !== "HEAD") ||
      request.path === "/api" ||
      request.path.startsWith("/api/")
    ) {
      next();
      return;
    }

    const indexable = isIndexablePublicWebPath(request.path);
    const applicationPath = isApplicationWebPath(request.path);
    if (!indexable) {
      response.setHeader("X-Robots-Tag", "noindex, nofollow");
    }
    setWebAppHeaders(response);
    response.setHeader("Cache-Control", "no-cache");
    response
      .status(indexable || applicationPath ? 200 : 404)
      .type("html")
      .send(renderIndexDocument(indexTemplate, request.path));
  });
}
