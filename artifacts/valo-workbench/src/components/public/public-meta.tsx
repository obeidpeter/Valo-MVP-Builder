import { useEffect } from "react";

function setMeta(name: string, content: string, property = false) {
  const selector = property
    ? `meta[property="${name}"]`
    : `meta[name="${name}"]`;
  let node = document.head.querySelector<HTMLMetaElement>(selector);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(property ? "property" : "name", name);
    document.head.appendChild(node);
  }
  node.content = content;
}

export function PublicMeta({
  title,
  description,
  path,
  index = true,
}: {
  title: string;
  description: string;
  path: string;
  index?: boolean;
}) {
  useEffect(() => {
    const fullTitle = title === "Valo" ? title : `${title} | Valo`;
    document.title = fullTitle;
    setMeta("description", description);
    setMeta("og:title", fullTitle, true);
    setMeta("og:description", description, true);
    setMeta("twitter:title", fullTitle);
    setMeta("twitter:description", description);
    setMeta("robots", index ? "index, follow" : "noindex, nofollow");

    const canonicalUrl = new URL(path, window.location.origin).href;
    setMeta("og:url", canonicalUrl, true);
    let canonical = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;
  }, [description, index, path, title]);

  return null;
}
