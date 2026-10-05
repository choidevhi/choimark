import { convertFileSrc } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";

import { dirname, resolveLocalTarget } from "../lib/paths";

export type SanitizeMode = "preview" | "export";

let baseDir: string | null = null;
let mode: SanitizeMode = "preview";
let localDirs = new Set<string>();

const MEDIA_TAGS = new Set(["IMG", "SOURCE", "VIDEO", "AUDIO"]);

function toFileUrl(path: string): string {
  return `file:///${path.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/").replace(/%3A/i, ":")}`;
}

// Documents are untrusted input: raw HTML in a .md file must not run script
// inside the app, which has file system access through IPC. DOMPurify strips
// scripts and handlers; the CSP in tauri.conf.json is the second wall.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (MEDIA_TAGS.has(node.tagName)) {
    const src = node.getAttribute("src");

    if (src !== null && src !== "") {
      const local = resolveLocalTarget(src, baseDir);

      if (local !== null) {
        node.setAttribute("data-src", src);
        node.setAttribute("src", mode === "preview" ? convertFileSrc(local) : src.startsWith("file:") || /^[a-zA-Z]:/.test(src) ? toFileUrl(local) : src);
        localDirs.add(dirname(local));
      }
    }

    if (node.tagName === "IMG") {
      node.setAttribute("loading", "lazy");
      node.setAttribute("decoding", "async");
    }
  }

  if (node.tagName === "A") {
    node.removeAttribute("target");
  }
});

export interface Sanitized {
  html: string;
  localDirs: string[];
}

export function sanitizeHtml(html: string, base: string | null, sanitizeMode: SanitizeMode): Sanitized {
  baseDir = base;
  mode = sanitizeMode;
  localDirs = new Set();

  const clean = DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "iframe", "frame", "frameset", "object", "embed", "base", "meta", "link", "dialog"],
    FORBID_ATTR: ["autofocus", "formaction"],
    ALLOW_DATA_ATTR: true,
  });

  return { html: clean, localDirs: Array.from(localDirs) };
}
