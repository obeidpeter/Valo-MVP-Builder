import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("public SEO and privacy boundary", () => {
  it("keeps the public shell zoomable, indexable and independent of remote fonts", () => {
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    expect(html).toContain('lang="en-NG"');
    expect(html).toContain('name="robots" content="index, follow"');
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('property="og:image"');
    expect(html).not.toContain("maximum-scale");
    expect(html).not.toContain("fonts.googleapis.com");
  });

  it("lists every implemented public route and no account route in the sitemap", () => {
    const sitemap = readFileSync(
      resolve(root, "public", "sitemap.xml"),
      "utf8",
    );
    for (const path of [
      "/product",
      "/solutions",
      "/how-it-works",
      "/security",
      "/about",
      "/contact",
      "/privacy",
      "/terms",
    ]) {
      expect(sitemap).toContain(`replit.app${path}</loc>`);
    }
    expect(sitemap).not.toContain("/app</loc>");
    expect(sitemap).not.toContain("/sign-in</loc>");
  });

  it("keeps authentication and workspace prefixes out of crawler scope", () => {
    const robots = readFileSync(resolve(root, "public", "robots.txt"), "utf8");
    for (const path of [
      "/app",
      "/projects",
      "/reports",
      "/organisation-settings",
      "/account",
      "/sign-in",
    ]) {
      expect(robots).toContain(`Disallow: ${path}`);
    }
  });

  it("ships a crawler-compatible 1200 by 630 social preview", () => {
    const image = readFileSync(resolve(root, "public", "opengraph.png"));
    expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(image.readUInt32BE(16)).toBe(1200);
    expect(image.readUInt32BE(20)).toBe(630);
  });
});
