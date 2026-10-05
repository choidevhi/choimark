import katexImport from "@vscode/markdown-it-katex";
import hljs from "highlight.js/lib/common";
import dos from "highlight.js/lib/languages/dos";
import dart from "highlight.js/lib/languages/dart";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import elixir from "highlight.js/lib/languages/elixir";
import haskell from "highlight.js/lib/languages/haskell";
import latex from "highlight.js/lib/languages/latex";
import nginx from "highlight.js/lib/languages/nginx";
import powershell from "highlight.js/lib/languages/powershell";
import scala from "highlight.js/lib/languages/scala";
import vim from "highlight.js/lib/languages/vim";
import markdownit, { type MarkdownIt, type StateCore, type Token } from "markdown-it";
import anchor from "markdown-it-anchor";
import deflist from "markdown-it-deflist";
import { full as emoji } from "markdown-it-emoji";
import footnote from "markdown-it-footnote";
import frontMatter from "markdown-it-front-matter";
import alerts from "markdown-it-github-alerts";
import mark from "markdown-it-mark";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";

const katex = typeof katexImport === "function" ? katexImport : katexImport.default;

hljs.registerLanguage("dos", dos);
hljs.registerLanguage("dart", dart);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("elixir", elixir);
hljs.registerLanguage("haskell", haskell);
hljs.registerLanguage("latex", latex);
hljs.registerLanguage("nginx", nginx);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("scala", scala);
hljs.registerLanguage("vim", vim);
hljs.registerAliases(["ps1", "pwsh"], { languageName: "powershell" });
hljs.registerAliases(["bat", "cmd"], { languageName: "dos" });
hljs.registerAliases(["tex"], { languageName: "latex" });
hljs.registerAliases(["sh", "zsh"], { languageName: "bash" });

export interface Heading {
  level: number;
  text: string;
  /** 0-based source line */
  line: number;
  id: string;
}

export interface RenderResult {
  html: string;
  headings: Heading[];
}

export interface RenderOptions {
  breaks: boolean;
}

/** GitHub-style heading ids that keep Hangul and other letters. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

export function hashText(text: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function lineAttr(token: Token): string {
  return token.map === null ? "" : ` data-line="${token.map[0]}"`;
}

function highlight(code: string, lang: string): string {
  if (lang !== "" && hljs.getLanguage(lang) !== undefined) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      return escapeHtml(code);
    }
  }

  return escapeHtml(code);
}

const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

function sourceLines(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.map === null || token.type === "inline") {
      continue;
    }

    if (token.nesting === 1 || (token.nesting === 0 && token.block)) {
      token.attrSet("data-line", String(token.map[0]));
    }
  }
}

const TASK_MARKER = /^\[([ xX])\](?=\s|$)\s?/;

/** `- [ ] item` lists, with the source line kept so the preview can toggle it. */
function taskLists(state: StateCore): void {
  const tokens = state.tokens;

  for (let i = 2; i < tokens.length; i += 1) {
    const inline = tokens[i];
    const paragraph = tokens[i - 1];
    const item = tokens[i - 2];

    if (inline === undefined || paragraph === undefined || item === undefined) {
      continue;
    }

    if (inline.type !== "inline" || paragraph.type !== "paragraph_open" || item.type !== "list_item_open") {
      continue;
    }

    const match = TASK_MARKER.exec(inline.content);
    const first = inline.children?.[0];

    if (match === null || first === undefined || first.type !== "text" || !first.content.startsWith(match[0].trimEnd())) {
      continue;
    }

    const checked = match[1] !== " ";
    const line = item.map === null ? -1 : item.map[0];
    first.content = first.content.slice(match[0].length).replace(/^\s/, "");
    const box = new state.Token("html_inline", "", 0);
    box.content = `<input type="checkbox" class="task-checkbox"${checked ? " checked" : ""} data-task-line="${line}">`;
    inline.children?.unshift(box);
    item.attrJoin("class", "task-list-item");

    for (let j = i - 3; j >= 0; j -= 1) {
      const parent = tokens[j];

      if (parent === undefined) {
        break;
      }

      if (parent.level === item.level - 1 && (parent.type === "bullet_list_open" || parent.type === "ordered_list_open")) {
        if (!String(parent.attrGet("class") ?? "").includes("contains-task-list")) {
          parent.attrJoin("class", "contains-task-list");
        }

        break;
      }
    }
  }
}

// The plugin hands the YAML to its callback during parse; rendering of the
// same document follows synchronously, so the latest value is the right one.
let parsedFrontMatter = "";

function renderFrontMatter(token: Token): string {
  const yaml = parsedFrontMatter;
  const rows: string[] = [];
  let simple = true;

  for (const raw of yaml.split("\n")) {
    const line = raw.trimEnd();

    if (line === "") {
      continue;
    }

    const match = /^([^\s:#][^:]*):\s*(.*)$/.exec(line);

    if (match === null) {
      simple = false;
      break;
    }

    rows.push(`<tr><th>${escapeHtml(match[1] ?? "")}</th><td>${escapeHtml(match[2] ?? "")}</td></tr>`);
  }

  const body = simple && rows.length > 0 ? `<table>${rows.join("")}</table>` : `<pre>${escapeHtml(yaml)}</pre>`;

  return `<div class="front-matter"${lineAttr(token)}>${body}</div>`;
}

function createRenderer(breaks: boolean): MarkdownIt {
  const md = markdownit({
    html: true,
    linkify: true,
    breaks,
    typographer: false,
  });

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];

    if (token === undefined) {
      return "";
    }

    const lang = token.info.trim().split(/\s+/)[0] ?? "";
    const line = lineAttr(token);

    if (lang.toLowerCase() === "mermaid") {
      return `<div class="mermaid-block"${line} data-mermaid="${hashText(token.content)}"><pre class="mermaid-source">${escapeHtml(token.content)}</pre></div>\n`;
    }

    const label = lang === "" ? "text" : lang;
    const code = highlight(token.content, lang.toLowerCase());

    return `<div class="code-block"${line}><div class="code-toolbar"><span class="code-lang">${escapeHtml(label)}</span><button type="button" class="code-copy" title="코드 복사">${COPY_ICON}<span>복사</span></button></div><pre class="hljs"><code>${code}</code></pre></div>\n`;
  };

  md.renderer.rules.code_block = (tokens, idx) => {
    const token = tokens[idx];

    if (token === undefined) {
      return "";
    }

    return `<div class="code-block"${lineAttr(token)}><pre class="hljs"><code>${escapeHtml(token.content)}</code></pre></div>\n`;
  };

  md.renderer.rules.table_open = (tokens, idx) => {
    const token = tokens[idx];

    return `<div class="table-wrap"${token === undefined ? "" : lineAttr(token)}><table>\n`;
  };

  md.renderer.rules.table_close = () => "</table></div>\n";

  md.use(frontMatter, (yaml: string) => {
    parsedFrontMatter = yaml;
  });

  md.renderer.rules.front_matter = (tokens, idx) => {
    const token = tokens[idx];

    return token === undefined ? "" : renderFrontMatter(token);
  };

  md.use(katex, { enableFencedBlocks: true, throwOnError: false, trust: false });

  const mathBlock = md.renderer.rules.math_block;

  if (mathBlock !== undefined) {
    md.renderer.rules.math_block = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const html = mathBlock(tokens, idx, options, env, self);

      return token === undefined ? html : `<div class="math-block"${lineAttr(token)}>${html}</div>`;
    };
  }

  md.use(footnote);
  md.use(deflist);
  md.use(mark);
  md.use(sub);
  md.use(sup);
  md.use(emoji);
  md.use(alerts, {
    titles: {
      note: "참고",
      tip: "팁",
      important: "중요",
      warning: "경고",
      caution: "주의",
    },
  });

  md.use(anchor, { slugify, tabIndex: false });
  md.core.ruler.push("task_lists", taskLists);
  md.core.ruler.push("source_lines", sourceLines);

  return md;
}

const renderers = new Map<boolean, MarkdownIt>();

function rendererFor(breaks: boolean): MarkdownIt {
  const existing = renderers.get(breaks);

  if (existing !== undefined) {
    return existing;
  }

  const created = createRenderer(breaks);
  renderers.set(breaks, created);

  return created;
}

function inlineText(token: Token | undefined): string {
  if (token === undefined || token.children === null) {
    return "";
  }

  let text = "";

  for (const child of token.children) {
    if (child.type === "text" || child.type === "code_inline" || child.type === "math_inline") {
      text += child.content;
    } else if (child.type === "emoji") {
      text += child.content;
    }
  }

  return text.trim();
}

function collectHeadings(tokens: Token[]): Heading[] {
  const headings: Heading[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token === undefined || token.type !== "heading_open" || token.level !== 0) {
      continue;
    }

    headings.push({
      level: Number(token.tag.slice(1)),
      text: inlineText(tokens[i + 1]),
      line: token.map === null ? 0 : token.map[0],
      id: String(token.attrGet("id") ?? ""),
    });
  }

  return headings;
}

export function renderMarkdown(source: string, options: RenderOptions): RenderResult {
  const md = rendererFor(options.breaks);
  parsedFrontMatter = "";
  const tokens = md.parse(source, {});

  return {
    html: md.renderer.render(tokens, md.options, {}),
    headings: collectHeadings(tokens),
  };
}
