import morphdom from "morphdom";

import { editor } from "../editor/controller";
import { ipc } from "../lib/ipc";
import { renderMarkdown, type Heading } from "../lib/markdown";
import { dirname, pathKey } from "../lib/paths";
import { activeTab, getState, useApp } from "../state/store";
import { mermaidKey, renderMermaid } from "./mermaid";
import { sanitizeHtml } from "./sanitize";

interface LineMark {
  line: number;
  el: HTMLElement;
}

export interface PreviewHandlers {
  toggleTask: (line: number) => void;
  followLink: (href: string) => void;
  jumpToLine: (line: number) => void;
  contextMenu: (event: MouseEvent) => void;
}

const SYNC_OFFSET = 18;

function sameHeadings(a: Heading[], b: Heading[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((h, i) => {
    const other = b[i];

    return other !== undefined && h.line === other.line && h.text === other.text && h.level === other.level && h.id === other.id;
  });
}

export function isDarkTheme(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

class PreviewController {
  private scroller: HTMLElement | null = null;
  private article: HTMLElement | null = null;
  private timer = 0;
  private seq = 0;
  private marks: LineMark[] = [];
  private tops: number[] | null = null;
  private allowedDirs = new Set<string>();
  private ignoreScrollUntil = 0;
  private editorIgnoreUntil = 0;
  private lastRendered = "";
  handlers: PreviewHandlers | null = null;
  visible = true;

  mount(scroller: HTMLElement, article: HTMLElement): () => void {
    this.scroller = scroller;
    this.article = article;
    const onClick = (event: MouseEvent) => this.onClick(event);
    const onDblClick = (event: MouseEvent) => this.onDblClick(event);
    const onScroll = () => this.onPreviewScroll();

    const onLoad = () => {
      this.tops = null;
    };

    const onContext = (event: MouseEvent) => this.handlers?.contextMenu(event);

    const resize = new ResizeObserver(() => {
      this.tops = null;
    });

    article.addEventListener("click", onClick);
    article.addEventListener("dblclick", onDblClick);
    article.addEventListener("load", onLoad, true);
    scroller.addEventListener("contextmenu", onContext);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    resize.observe(article);

    const offEditor = editor.on((event) => {
      if (event.type === "scroll") {
        this.onEditorScroll();
      }
    });

    return () => {
      article.removeEventListener("click", onClick);
      article.removeEventListener("dblclick", onDblClick);
      article.removeEventListener("load", onLoad, true);
      scroller.removeEventListener("contextmenu", onContext);
      scroller.removeEventListener("scroll", onScroll);
      resize.disconnect();
      offEditor();
      this.scroller = null;
      this.article = null;
    };
  }

  /** Debounced render; larger documents wait longer between keystrokes. */
  schedule(immediate = false): void {
    window.clearTimeout(this.timer);
    const tab = activeTab();
    const size = tab === null ? 0 : (editor.doc(tab.id)?.length ?? 0);
    const delay = immediate ? 0 : Math.min(600, Math.max(70, size / 2500));
    this.timer = window.setTimeout(() => {
      void this.render();
    }, delay);
  }

  setVisible(visible: boolean): void {
    const wasHidden = !this.visible;
    this.visible = visible;

    if (visible && wasHidden) {
      this.lastRendered = "";
      this.schedule(true);
    }
  }

  invalidate(): void {
    this.lastRendered = "";
    this.schedule(true);
  }

  private async render(): Promise<void> {
    this.seq += 1;
    const seq = this.seq;
    const tab = activeTab();
    const article = this.article;

    if (tab === null) {
      useApp.setState({ outline: [] });

      if (article !== null) {
        article.innerHTML = "";
      }

      this.lastRendered = "";

      return;
    }

    const text = editor.text(tab.id);
    const settings = getState().settings;
    const { html, headings } = renderMarkdown(text, { breaks: settings.previewBreaks });

    if (!sameHeadings(getState().outline, headings)) {
      useApp.setState({ outline: headings });
    }

    if (!this.visible || article === null) {
      return;
    }

    const dark = isDarkTheme();
    const renderKey = `${tab.id}\u0000${dark ? 1 : 0}\u0000${tab.path ?? ""}\u0000${html}`;

    if (renderKey === this.lastRendered) {
      return;
    }

    const base = tab.path === null ? null : dirname(tab.path);
    const clean = sanitizeHtml(html, base, "preview");
    const fresh: string[] = [];

    for (const dir of clean.localDirs) {
      const key = pathKey(dir);

      if (!this.allowedDirs.has(key)) {
        this.allowedDirs.add(key);
        fresh.push(dir);
      }
    }

    if (fresh.length > 0) {
      await Promise.all(fresh.map((dir) => ipc.allowAssetDir(dir).catch(() => undefined)));
    }

    if (seq !== this.seq) {
      return;
    }

    const switchedTab = !this.lastRendered.startsWith(`${tab.id}\u0000`);
    morphdom(article, `<article>${clean.html}</article>`, {
      childrenOnly: true,
      onBeforeElUpdated(from, to) {
        if (from.isEqualNode(to)) {
          return false;
        }

        if (from instanceof HTMLElement && to instanceof HTMLElement && from.classList.contains("mermaid-block")) {
          const hash = to.dataset.mermaid ?? "";

          return from.dataset.rendered !== mermaidKey(hash, dark);
        }

        return true;
      },
    });

    this.lastRendered = renderKey;
    this.collectMarks();

    if (switchedTab) {
      this.syncFromEditor();
    }

    await renderMermaid(article, dark);
    this.tops = null;
  }

  private collectMarks(): void {
    const article = this.article;
    this.tops = null;
    this.marks = [];

    if (article === null) {
      return;
    }

    let previous = -1;

    for (const el of Array.from(article.querySelectorAll<HTMLElement>("[data-line]"))) {
      const line = Number(el.dataset.line);

      if (!Number.isFinite(line) || line < previous) {
        continue;
      }

      // Skip elements that are not laid out (e.g. inside closed <details>).
      if (el.offsetParent === null && el.getClientRects().length === 0) {
        continue;
      }

      previous = line;
      this.marks.push({ line, el });
    }
  }

  private positions(): number[] {
    if (this.tops !== null) {
      return this.tops;
    }

    const scroller = this.scroller;

    if (scroller === null) {
      return [];
    }

    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const tops: number[] = [];

    for (const mark of this.marks) {
      tops.push(mark.el.getBoundingClientRect().top - base);
    }

    this.tops = tops;

    return tops;
  }

  private onEditorScroll(): void {
    if (performance.now() < this.editorIgnoreUntil) {
      return;
    }

    this.syncFromEditor();
  }

  syncFromEditor(): void {
    const scroller = this.scroller;

    if (scroller === null || !this.visible || !getState().settings.syncScroll || getState().viewMode !== "split") {
      return;
    }

    if (editor.scrollToEnd() && editor.topLine() > 1) {
      this.setPreviewScroll(scroller.scrollHeight);

      return;
    }

    this.setPreviewScroll(this.offsetForLine(editor.topLine()));
  }

  private setPreviewScroll(top: number): void {
    const scroller = this.scroller;

    if (scroller === null) {
      return;
    }

    this.ignoreScrollUntil = performance.now() + 120;
    scroller.scrollTop = Math.max(0, top);
  }

  offsetForLine(line: number): number {
    const tops = this.positions();
    const marks = this.marks;

    if (marks.length === 0) {
      return 0;
    }

    let lo = 0;
    let hi = marks.length - 1;
    let found = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;

      if ((marks[mid]?.line ?? 0) <= line) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (found < 0) {
      const firstLine = marks[0]?.line ?? 1;
      const firstTop = tops[0] ?? 0;

      return firstLine <= 0 ? 0 : (line / firstLine) * firstTop - SYNC_OFFSET;
    }

    const current = marks[found];
    const next = marks[found + 1];
    const currentTop = tops[found] ?? 0;

    if (current === undefined) {
      return 0;
    }

    if (next === undefined || next.line === current.line) {
      const height = current.el.getBoundingClientRect().height;
      const span = Math.max(1, line - current.line + 1);

      return currentTop + Math.min(height, (line - current.line) * (height / span)) - SYNC_OFFSET;
    }

    const nextTop = tops[found + 1] ?? currentTop;
    const ratio = (line - current.line) / (next.line - current.line);

    return currentTop + ratio * (nextTop - currentTop) - SYNC_OFFSET;
  }

  private onPreviewScroll(): void {
    if (performance.now() < this.ignoreScrollUntil) {
      return;
    }

    const scroller = this.scroller;

    if (scroller === null || !getState().settings.syncScroll || getState().viewMode !== "split") {
      return;
    }

    const tops = this.positions();
    const y = scroller.scrollTop + SYNC_OFFSET;
    let found = -1;

    for (let i = 0; i < tops.length; i += 1) {
      if ((tops[i] ?? 0) <= y) {
        found = i;
      } else {
        break;
      }
    }

    let line = 0;
    const current = this.marks[found];

    if (current !== undefined) {
      const next = this.marks[found + 1];
      const currentTop = tops[found] ?? 0;
      const nextTop = tops[found + 1];

      line = current.line;

      if (next !== undefined && nextTop !== undefined && nextTop > currentTop) {
        line += ((y - currentTop) / (nextTop - currentTop)) * (next.line - current.line);
      }
    }

    this.editorIgnoreUntil = performance.now() + 120;

    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
      editor.scrollToLine(Number.MAX_SAFE_INTEGER);

      return;
    }

    editor.scrollToLine(line);
  }

  scrollToLine(line: number): void {
    this.setPreviewScroll(this.offsetForLine(line));
  }

  scrollToAnchor(id: string): boolean {
    const article = this.article;
    const scroller = this.scroller;

    if (article === null || scroller === null) {
      return false;
    }

    const target = Array.from(article.querySelectorAll<HTMLElement>("[id]")).find((el) => el.id === id);

    if (target === undefined) {
      return false;
    }

    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({ top: Math.max(0, top - 16), behavior: "smooth" });

    return true;
  }

  private onClick(event: MouseEvent): void {
    const target = event.target;

    if (!(target instanceof Element) || this.handlers === null) {
      return;
    }

    const checkbox = target.closest("input.task-checkbox");

    if (checkbox instanceof HTMLInputElement) {
      event.preventDefault();
      const line = Number(checkbox.dataset.taskLine);

      if (Number.isFinite(line) && line >= 0) {
        this.handlers.toggleTask(line);
      }

      return;
    }

    const copy = target.closest(".code-copy");

    if (copy instanceof HTMLElement) {
      event.preventDefault();
      const code = copy.closest(".code-block")?.querySelector("pre code")?.textContent ?? "";
      void navigator.clipboard.writeText(code).then(() => {
        copy.classList.add("copied");
        const label = copy.querySelector("span");

        if (label !== null) {
          label.textContent = "복사됨";
        }

        window.setTimeout(() => {
          copy.classList.remove("copied");

          if (label !== null) {
            label.textContent = "복사";
          }
        }, 1400);
      });

      return;
    }

    const link = target.closest("a");

    if (link instanceof HTMLAnchorElement) {
      event.preventDefault();
      this.handlers.followLink(link.getAttribute("href") ?? "");
    }
  }

  private onDblClick(event: MouseEvent): void {
    const target = event.target;

    if (!(target instanceof Element) || this.handlers === null) {
      return;
    }

    if (target.closest("a, input, button, .code-copy") !== null) {
      return;
    }

    const block = target.closest<HTMLElement>("[data-line]");

    if (block !== null) {
      this.handlers.jumpToLine(Number(block.dataset.line));
    }
  }

  /** Current preview HTML, for copying and export. */
  html(): string {
    return this.article?.innerHTML ?? "";
  }

  selectionHtml(): string {
    const selection = window.getSelection();
    const article = this.article;

    if (selection === null || selection.rangeCount === 0 || article === null) {
      return "";
    }

    const range = selection.getRangeAt(0);

    if (!article.contains(range.commonAncestorContainer)) {
      return "";
    }

    const holder = document.createElement("div");
    holder.appendChild(range.cloneContents());

    return holder.innerHTML;
  }
}

export const preview = new PreviewController();
