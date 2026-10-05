import hljsCss from "../styles/hljs.css?inline";
import previewCss from "../styles/preview.css?inline";
import { renderMarkdown } from "../lib/markdown";
import { renderMermaid } from "../preview/mermaid";
import { sanitizeHtml } from "../preview/sanitize";

const EXPORT_VARS = `
:root {
  color-scheme: light;
  --md-text: #1f2328; --md-muted: #59636e; --md-faint: #8b949e; --md-heading: #111418;
  --md-border: #e4e7ec; --md-border-strong: #d0d5dd; --md-surface: #f6f8fa; --md-code-bg: #f3f4f6;
  --md-code-text: #b4235c; --md-link: #4b49c4; --md-mark-bg: #fff3b0; --md-quote-bar: #d0d4f7;
  --md-table-head: #f6f7f9; --md-table-stripe: #fafbfc; --md-kbd-bg: #f6f8fa;
  --hl-comment: #6a737d; --hl-keyword: #cf222e; --hl-string: #0a3069; --hl-number: #0550ae;
  --hl-function: #8250df; --hl-type: #953800; --hl-attr: #0550ae; --hl-tag: #116329;
  --hl-regexp: #0a3069; --hl-variable: #953800; --hl-meta: #6639ba; --hl-addition-bg: #dafbe1;
  --hl-deletion-bg: #ffebe9; --code-block-bg: #f6f8fa; --code-toolbar: #8b949e;
  --alert-note: #0969da; --alert-tip: #1a7f37; --alert-important: #8250df; --alert-warning: #9a6700; --alert-caution: #cf222e;
  --preview-font-size: 16px; --preview-max-width: 860px;
  --font-ui: "Pretendard Variable", Pretendard, "Segoe UI Variable Text", "Segoe UI", "Malgun Gothic", sans-serif;
  --font-mono: "D2Coding", "JetBrains Mono", Consolas, "Malgun Gothic", monospace;
}
body { margin: 0; background: #fff; }
.code-copy { display: none !important; }
`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Renders a document body for export: original image paths, mermaid as SVG. */
export async function renderForExport(source: string, baseDir: string | null, breaks: boolean): Promise<string> {
  const { html } = renderMarkdown(source, { breaks });
  const clean = sanitizeHtml(html, baseDir, "export");
  const holder = document.createElement("div");
  holder.innerHTML = clean.html;
  await renderMermaid(holder, false);

  for (const el of Array.from(holder.querySelectorAll("[data-line], [data-src], [data-task-line], [data-mermaid], [data-rendered], [data-source]"))) {
    el.removeAttribute("data-line");
    el.removeAttribute("data-src");
    el.removeAttribute("data-mermaid");
    el.removeAttribute("data-rendered");
    el.removeAttribute("data-source");
  }

  for (const box of Array.from(holder.querySelectorAll("input.task-checkbox"))) {
    box.setAttribute("disabled", "");
  }

  for (const button of Array.from(holder.querySelectorAll(".code-copy"))) {
    button.remove();
  }

  return holder.innerHTML;
}

export function standaloneHtml(title: string, body: string): string {
  const katex = body.includes('class="katex')
    ? '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.css">\n'
    : "";

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="ChoiMark">
<title>${escapeHtml(title)}</title>
${katex}<style>
${EXPORT_VARS}
${previewCss}
${hljsCss}
</style>
</head>
<body>
<article class="markdown-body">
${body}
</article>
</body>
</html>
`;
}
