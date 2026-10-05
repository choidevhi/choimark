type MermaidApi = (typeof import("mermaid"))["default"];

let api: Promise<MermaidApi> | null = null;
let configuredTheme = "";
let counter = 0;
const cache = new Map<string, string>();

function load(): Promise<MermaidApi> {
  api ??= import("mermaid").then((module) => module.default);

  return api;
}

async function ready(dark: boolean): Promise<MermaidApi> {
  const mermaid = await load();
  const theme = dark ? "dark" : "default";

  if (configuredTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme,
      fontFamily: '"Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif',
    });

    configuredTheme = theme;
  }

  return mermaid;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function mermaidKey(hash: string, dark: boolean): string {
  return `${dark ? "dark" : "light"}:${hash}`;
}

/** Renders every `.mermaid-block` that does not already show this source and theme. */
export async function renderMermaid(root: HTMLElement, dark: boolean): Promise<void> {
  const blocks = root.querySelectorAll<HTMLElement>(".mermaid-block");

  if (blocks.length === 0) {
    return;
  }

  const mermaid = await ready(dark);

  for (const block of Array.from(blocks)) {
    const hash = block.dataset.mermaid ?? "";
    const key = mermaidKey(hash, dark);

    if (block.dataset.rendered === key) {
      continue;
    }

    const source = block.querySelector(".mermaid-source")?.textContent ?? block.dataset.source ?? "";
    block.dataset.source = source;
    let svg = cache.get(key);

    if (svg === undefined) {
      try {
        counter += 1;
        const result = await mermaid.render(`choimark-mermaid-${counter}`, source);
        svg = result.svg;
        cache.set(key, svg);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        block.innerHTML = `<div class="mermaid-error"><strong>다이어그램 오류</strong><pre>${escapeHtml(message)}</pre></div>`;
        block.dataset.rendered = key;
        continue;
      }
    }

    block.innerHTML = `<div class="mermaid-svg">${svg}</div>`;
    block.dataset.rendered = key;
  }
}
