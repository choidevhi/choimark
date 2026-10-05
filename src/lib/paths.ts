// Windows path helpers. The webview has no `path` module, and Tauri's async
// path API is overkill for string work done on every render.

export const MARKDOWN_EXTENSIONS = [
  "md",
  "markdown",
  "mdown",
  "mkd",
  "mkdn",
  "mdwn",
  "mdtxt",
  "mdtext",
  "mdx",
  "rmd",
] as const;

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"] as const;

const SEPARATOR = /[\\/]/;

export function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("//");
}

export function basename(path: string): string {
  const parts = path.split(SEPARATOR);

  return parts[parts.length - 1] ?? path;
}

export function dirname(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));

  if (index < 0) {
    return "";
  }

  const dir = path.slice(0, index);

  // Keep the root as "C:\" rather than "C:".
  return /^[a-zA-Z]:$/.test(dir) ? `${dir}\\` : dir;
}

export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function stem(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(0, dot) : name;
}

export function isMarkdownPath(path: string): boolean {
  const ext = extname(path);

  return MARKDOWN_EXTENSIONS.some((candidate) => candidate === ext);
}

export function isImagePath(path: string): boolean {
  const ext = extname(path);

  return IMAGE_EXTENSIONS.some((candidate) => candidate === ext);
}

/** Joins and normalizes `.`/`..` segments, always with backslashes. */
export function joinPath(base: string, relative: string): string {
  if (isAbsolutePath(relative)) {
    return normalizePath(relative);
  }

  return normalizePath(`${base}\\${relative}`);
}

export function normalizePath(path: string): string {
  const unc = path.startsWith("\\\\") || path.startsWith("//");
  const parts = path.split(SEPARATOR);
  const out: string[] = [];

  for (const part of parts) {
    if (part === "" || part === ".") {
      continue;
    }

    if (part === "..") {
      if (out.length > 1 || (out.length === 1 && !/^[a-zA-Z]:$/.test(out[0] ?? ""))) {
        out.pop();
      }

      continue;
    }

    out.push(part);
  }

  const joined = out.join("\\");

  if (unc) {
    return `\\\\${joined}`;
  }

  return /^[a-zA-Z]:$/.test(joined) ? `${joined}\\` : joined;
}

export function pathKey(path: string): string {
  return normalizePath(path).toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

/** Relative path from a folder to a file with forward slashes, or null across drives. */
export function relativePath(fromDir: string, toPath: string): string | null {
  const from = normalizePath(fromDir).split("\\");
  const to = normalizePath(toPath).split("\\");

  if ((from[0] ?? "").toLowerCase() !== (to[0] ?? "").toLowerCase()) {
    return null;
  }

  let shared = 0;

  while (shared < from.length && shared < to.length && (from[shared] ?? "").toLowerCase() === (to[shared] ?? "").toLowerCase()) {
    shared += 1;
  }

  const ups = from.slice(shared).filter((part) => part !== "").length;
  const rest = to.slice(shared);
  const segments = [...Array.from({ length: ups }, () => ".."), ...rest];

  return segments.join("/");
}

/** Encodes a relative path for a Markdown link: spaces and parentheses break `[](...)`. */
export function encodeLinkPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ":"))
    .join("/");
}

export function isExternalUrl(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href);
}

export function hasUrlScheme(href: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) && !/^[a-zA-Z]:[\\/]/.test(href);
}

export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Resolves a link or image target from a document to a local path, if it is one. */
export function resolveLocalTarget(target: string, baseDir: string | null): string | null {
  const clean = target.split("#")[0]?.split("?")[0] ?? "";

  if (clean === "") {
    return null;
  }

  if (/^file:/i.test(clean)) {
    const stripped = safeDecode(clean.replace(/^file:\/*/i, ""));

    return normalizePath(stripped);
  }

  if (hasUrlScheme(clean)) {
    return null;
  }

  const decoded = safeDecode(clean);

  if (isAbsolutePath(decoded)) {
    return normalizePath(decoded);
  }

  if (baseDir === null) {
    return null;
  }

  return joinPath(baseDir, decoded);
}
