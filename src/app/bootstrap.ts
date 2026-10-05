import { EditorSelection } from "@codemirror/state";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { editor } from "../editor/controller";
import { ipc } from "../lib/ipc";
import type { Settings } from "../lib/settings";
import { preview } from "../preview/preview";
import { getState, openMenu, toast, useApp } from "../state/store";
import {
  checkDefaultApp,
  copyAsRichText,
  exportHtml,
  followLink,
  handleDrop,
  jumpToSource,
  onDocChanged,
  onEditorBlur,
  openPaths,
  pasteImage,
  printToPdf,
  queueFileChanged,
  refreshCursor,
  requestClose,
  restoreSession,
  toggleTaskAtLine,
} from "./actions";
import { runCommand } from "./commands";
import { installKeyHandling } from "./keys";

const EDITOR_FONTS: Record<Settings["editorFont"], string> = {
  d2coding: '"D2Coding", "JetBrains Mono Variable", Consolas, "Malgun Gothic", monospace',
  jetbrains: '"JetBrains Mono Variable", "JetBrains Mono", Consolas, "D2Coding", "Pretendard Variable", "Malgun Gothic", monospace',
  sans: '"Pretendard Variable", Pretendard, "Segoe UI Variable Text", "Segoe UI", "Malgun Gothic", sans-serif',
};

const PREVIEW_WIDTHS: Record<Settings["previewWidth"], string> = {
  narrow: "680px",
  normal: "820px",
  wide: "1040px",
  full: "none",
};

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
let lastDark: boolean | null = null;

export function applyAppearance(): void {
  const { settings } = getState();
  const dark = settings.theme === "dark" || (settings.theme === "system" && darkQuery.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.setProperty("--editor-font", EDITOR_FONTS[settings.editorFont]);
  root.style.setProperty("--editor-font-size", `${settings.editorFontSize}px`);
  root.style.setProperty("--preview-font-size", `${settings.previewFontSize}px`);
  root.style.setProperty("--preview-max-width", PREVIEW_WIDTHS[settings.previewWidth]);
  editor.applySettings(settings, dark);

  if (lastDark !== dark) {
    lastDark = dark;
    void getCurrentWindow()
      .setTheme(dark ? "dark" : "light")
      .catch(() => undefined);
    preview.invalidate();
  }
}

function wrapSelectionAsLink(url: string): boolean {
  return editor.run((state) =>
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to);
      const insert = `[${text}](${url})`;

      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length) };
    }),
  );
}

async function pasteFromMenu(): Promise<void> {
  try {
    const items = await navigator.clipboard.read();

    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith("image/"));

      if (imageType !== undefined) {
        const blob = await item.getType(imageType);
        await pasteImage(new File([blob], "clipboard", { type: imageType }));

        return;
      }
    }

    editor.insertText(await navigator.clipboard.readText());
  } catch {
    toast("클립보드를 읽지 못했습니다. Ctrl+V로 붙여 넣으세요.", "error");
  }
}

function editorMenu(event: MouseEvent): void {
  event.preventDefault();
  const hasSelection = editor.selectionText() !== "";
  openMenu(event, [
    { label: "잘라내기", keys: "Ctrl+X", disabled: !hasSelection, run: () => document.execCommand("cut") },
    { label: "복사", keys: "Ctrl+C", disabled: !hasSelection, run: () => document.execCommand("copy") },
    { label: "붙여넣기", keys: "Ctrl+V", run: () => void pasteFromMenu() },
    { label: "모두 선택", keys: "Ctrl+A", run: () => editor.runView((view) => {
      view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) });

      return true;
    }) },
    "separator",
    { label: "굵게", keys: "Ctrl+B", run: () => runCommand("fmt.bold") },
    { label: "기울임", keys: "Ctrl+I", run: () => runCommand("fmt.italic") },
    { label: "인라인 코드", keys: "Ctrl+`", run: () => runCommand("fmt.code") },
    { label: "링크 넣기", keys: "Ctrl+K", run: () => runCommand("ins.link") },
    "separator",
    { label: "표 넣기", keys: "Ctrl+T", run: () => runCommand("ins.table") },
    { label: "표 정렬", keys: "Alt+Shift+F", run: () => runCommand("fmt.table") },
    { label: "찾기 / 바꾸기", keys: "Ctrl+F", run: () => runCommand("edit.find") },
  ]);
}

function previewMenu(event: MouseEvent): void {
  event.preventDefault();
  const selected = window.getSelection()?.toString() ?? "";
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest("a")?.getAttribute("href") ?? null;
  const image = target?.closest("img");
  const block = target?.closest<HTMLElement>("[data-line]");
  const items: Parameters<typeof openMenu>[1] = [];

  if (link !== null) {
    items.push({ label: "링크 열기", run: () => void followLink(link) });
    items.push({ label: "링크 주소 복사", run: () => void navigator.clipboard.writeText(link) });
    items.push("separator");
  }

  if (image instanceof HTMLImageElement) {
    items.push({
      label: "이미지 주소 복사",
      run: () => void navigator.clipboard.writeText(image.dataset.src ?? image.src),
    });
    items.push("separator");
  }

  items.push({ label: "복사", keys: "Ctrl+C", disabled: selected === "", run: () => document.execCommand("copy") });

  if (block !== null && block !== undefined) {
    items.push({ label: "이 부분 편집하기", run: () => jumpToSource(Number(block.dataset.line)) });
  }

  items.push("separator");
  items.push({ label: "서식 있는 텍스트로 복사", keys: "Ctrl+Alt+C", run: () => void copyAsRichText() });
  items.push({ label: "HTML로 내보내기…", run: () => void exportHtml() });
  items.push({ label: "PDF로 저장 / 인쇄…", keys: "Ctrl+Alt+P", run: () => void printToPdf() });
  openMenu(event, items);
}

export { editorMenu };

let booted = false;

export async function bootstrap(): Promise<void> {
  if (booted) {
    return;
  }

  booted = true;
  applyAppearance();
  darkQuery.addEventListener("change", applyAppearance);
  useApp.subscribe((state, prev) => {
    if (state.settings !== prev.settings) {
      applyAppearance();
    }

    if (state.settings.previewBreaks !== prev.settings.previewBreaks) {
      preview.invalidate();
    }

    if (state.outline !== prev.outline) {
      refreshCursor();
    }
  });

  editor.hooks = {
    pasteImage: (file) => void pasteImage(file),
    pasteUrlOnSelection: wrapSelectionAsLink,
  };

  editor.on((event) => {
    if (event.type === "change") {
      onDocChanged(event.tabId, event.dirty);
    } else if (event.type === "selection") {
      refreshCursor();
    } else if (event.type === "blur") {
      onEditorBlur();
    }
  });

  preview.handlers = {
    toggleTask: toggleTaskAtLine,
    followLink: (href) => void followLink(href),
    jumpToLine: jumpToSource,
    contextMenu: previewMenu,
  };

  preview.setVisible(getState().viewMode !== "edit");
  installKeyHandling();

  const appWindow = getCurrentWindow();
  await listen<string[]>("open-paths", (event) => void openPaths(event.payload));
  await listen<string>("file-changed", (event) => queueFileChanged(event.payload));

  await getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload;

    if (payload.type === "enter" || payload.type === "over") {
      if (!getState().dragOver) {
        useApp.setState({ dragOver: true });
      }
    } else if (payload.type === "leave") {
      useApp.setState({ dragOver: false });
    } else {
      useApp.setState({ dragOver: false });
      void handleDrop(payload.paths);
    }
  });

  await appWindow.onCloseRequested((event) => {
    event.preventDefault();
    void requestClose();
  });

  await appWindow.onResized(() => {
    void appWindow.isMaximized().then((maximized) => {
      if (maximized !== getState().maximized) {
        useApp.setState({ maximized });
      }
    });
  });

  useApp.setState({ maximized: await appWindow.isMaximized() });

  let assocTimer = 0;
  window.addEventListener("focus", () => {
    window.clearTimeout(assocTimer);
    assocTimer = window.setTimeout(() => void checkDefaultApp(), 400);
  });

  void ipc
    .platformInfo()
    .then((platform) => useApp.setState({ platform }))
    .catch(() => undefined);

  await restoreSession();
  await openPaths(await ipc.takeStartupPaths());
  void checkDefaultApp();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void appWindow
        .show()
        .then(() => appWindow.setFocus())
        .catch(() => undefined);
    });
  });
}
