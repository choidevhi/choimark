import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

import { editor } from "../editor/controller";
import { insertImageLink, taskToggleChange } from "../editor/format";
import { errorText, ipc } from "../lib/ipc";
import {
  basename,
  dirname,
  encodeLinkPath,
  isExternalUrl,
  isImagePath,
  isMarkdownPath,
  normalizePath,
  relativePath,
  resolveLocalTarget,
  safeDecode,
  samePath,
  stem,
} from "../lib/paths";
import { parseSession, saveItem, loadItem, type Settings, type ViewMode } from "../lib/settings";
import { preview } from "../preview/preview";
import { activeTab, ask, getState, toast, updateTab, useApp, type SidebarPanel, type Tab } from "../state/store";
import { renderForExport, standaloneHtml } from "./exporter";

let tabSeq = 0;
const closedPaths: string[] = [];
const MAX_RECENT = 16;

function nextTabId(): string {
  tabSeq += 1;

  return `tab-${tabSeq}`;
}

function untitledTitle(): string {
  const taken = new Set(getState().tabs.map((tab) => tab.title));

  if (!taken.has("제목 없음")) {
    return "제목 없음";
  }

  let n = 2;

  while (taken.has(`제목 없음 ${n}`)) {
    n += 1;
  }

  return `제목 없음 ${n}`;
}

function findTabByPath(path: string): Tab | undefined {
  return getState().tabs.find((tab) => tab.path !== null && samePath(tab.path, path));
}

function isPristineUntitled(tab: Tab): boolean {
  return tab.path === null && !tab.dirty && editor.text(tab.id) === "";
}

// ---------------------------------------------------------------- recent

function pushRecent(path: string): void {
  const recent = [path, ...getState().recent.filter((p) => !samePath(p, path))].slice(0, MAX_RECENT);
  useApp.setState({ recent });
  saveItem("recent", JSON.stringify(recent));
}

function pushRecentFolder(dir: string): void {
  const recentFolders = [dir, ...getState().recentFolders.filter((p) => !samePath(p, dir))].slice(0, 8);
  useApp.setState({ recentFolders });
  saveItem("recentFolders", JSON.stringify(recentFolders));
}

export function clearRecent(): void {
  useApp.setState({ recent: [] });
  saveItem("recent", "[]");
}

// ---------------------------------------------------------------- session

let sessionTimer = 0;

export function persistSession(): void {
  window.clearTimeout(sessionTimer);
  sessionTimer = window.setTimeout(writeSession, 300);
}

function writeSession(): void {
  const state = getState();
  const paths: string[] = [];

  for (const tab of state.tabs) {
    if (tab.path !== null) {
      paths.push(tab.path);
    }
  }

  saveItem(
    "session",
    JSON.stringify({ paths, active: activeTab()?.path ?? null, rootDir: state.rootDir, viewMode: state.viewMode }),
  );
}

// ---------------------------------------------------------------- tabs

function syncWindowTitle(): void {
  const tab = activeTab();
  const title = tab === null ? "ChoiMark" : `${tab.dirty ? "● " : ""}${tab.title} - ChoiMark`;
  document.title = title;
  void getCurrentWindow()
    .setTitle(title)
    .catch(() => undefined);
}

export function activateTab(id: string | null): void {
  useApp.setState({ activeId: id });
  editor.activate(id);
  syncWindowTitle();
  preview.schedule(true);
  persistSession();
  refreshCursor();
  refreshStats();
}

export function refreshCursor(): void {
  const tab = activeTab();

  if (tab === null) {
    useApp.setState({ cursor: { line: 1, column: 1, selected: 0 }, activeHeading: -1 });

    return;
  }

  const cursor = editor.cursor();
  const outline = getState().outline;
  let activeHeading = -1;

  for (let i = 0; i < outline.length; i += 1) {
    if ((outline[i]?.line ?? Number.MAX_SAFE_INTEGER) <= cursor.line - 1) {
      activeHeading = i;
    } else {
      break;
    }
  }

  useApp.setState({ cursor, activeHeading });
}

let statsTimer = 0;

export function refreshStats(): void {
  window.clearTimeout(statsTimer);
  statsTimer = window.setTimeout(() => {
    const tab = activeTab();
    const doc = tab === null ? null : editor.doc(tab.id);

    if (doc === null) {
      useApp.setState({ stats: { words: 0, chars: 0, charsNoSpace: 0, lines: 1 } });

      return;
    }

    const text = doc.toString();
    const words = text.match(/[^\s#>*_`~|\-[\]()]+/gu)?.length ?? 0;
    const charsNoSpace = text.replace(/\s/g, "").length;
    useApp.setState({ stats: { words, chars: text.length, charsNoSpace, lines: doc.lines } });
  }, 250);
}

function addTab(tab: Tab, text: string): void {
  editor.open(tab.id, text);
  const state = getState();
  const current = state.tabs.find((t) => t.id === state.activeId);
  const replaceable = state.tabs.length === 1 && current !== undefined && isPristineUntitled(current) && tab.path !== null;
  const base = replaceable ? [] : state.tabs;
  const index = base.findIndex((t) => t.id === state.activeId);
  const tabs = [...base];
  tabs.splice(index < 0 ? tabs.length : index + 1, 0, tab);
  useApp.setState({ tabs });

  if (replaceable && current !== undefined) {
    editor.close(current.id);
  }

  activateTab(tab.id);
}

export function newDocument(initial = ""): void {
  const tab: Tab = {
    id: nextTabId(),
    path: null,
    title: untitledTitle(),
    dirty: initial !== "",
    encoding: "utf-8",
    eol: "lf",
    mtimeMs: 0,
    readonly: false,
    conflict: false,
    missing: false,
  };

  addTab(tab, initial);

  if (getState().viewMode === "preview") {
    setViewMode("split");
  }

  requestAnimationFrame(() => editor.focus());
}

export interface OpenOptions {
  line?: number;
  column?: number;
  anchor?: string;
  quiet?: boolean;
}

export async function openFile(rawPath: string, options: OpenOptions = {}): Promise<string | null> {
  const path = normalizePath(rawPath);
  const existing = findTabByPath(path);

  if (existing !== undefined) {
    activateTab(existing.id);
    afterOpen(options);

    return existing.id;
  }

  try {
    const doc = await ipc.readDocument(path);
    const again = findTabByPath(path);

    if (again !== undefined) {
      activateTab(again.id);

      return again.id;
    }

    const tab: Tab = {
      id: nextTabId(),
      path: doc.path,
      title: basename(doc.path),
      dirty: false,
      encoding: doc.encoding,
      eol: doc.eol,
      mtimeMs: doc.mtimeMs,
      readonly: doc.readonly,
      conflict: false,
      missing: false,
    };

    addTab(tab, doc.content);
    void ipc.watchFile(doc.path).catch(() => undefined);
    pushRecent(doc.path);

    if (getState().rootDir === null) {
      setRootDir(dirname(doc.path), false);
    }

    afterOpen(options);

    return tab.id;
  } catch (cause) {
    if (options.quiet !== true) {
      toast(errorText(cause), "error", 5000);
    }

    return null;
  }
}

function afterOpen(options: OpenOptions): void {
  if (options.line !== undefined) {
    const line = options.line;
    requestAnimationFrame(() => {
      editor.goToLine(line, options.column ?? 0);
      preview.scrollToLine(line);
    });
  }

  if (options.anchor !== undefined) {
    const anchor = options.anchor;
    window.setTimeout(() => preview.scrollToAnchor(anchor), 250);
  }
}

export async function openPaths(paths: string[]): Promise<void> {
  for (const path of paths) {
    const stat = await ipc.statPath(path).catch(() => null);

    if (stat === null || !stat.exists) {
      continue;
    }

    if (stat.isDir) {
      setRootDir(path);
      continue;
    }

    await openFile(path);
  }
}

export async function openFileDialog(): Promise<void> {
  const tab = activeTab();
  const picked = await openDialog({
    multiple: true,
    directory: false,
    defaultPath: tab?.path === null || tab === null ? (getState().rootDir ?? undefined) : dirname(tab.path),
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "mdtxt", "mdtext", "mdx", "rmd"] },
      { name: "텍스트", extensions: ["txt", "text", "log"] },
      { name: "모든 파일", extensions: ["*"] },
    ],
  });

  if (picked === null) {
    return;
  }

  for (const path of Array.isArray(picked) ? picked : [picked]) {
    await openFile(path);
  }
}

export async function openFolderDialog(): Promise<void> {
  const picked = await openDialog({ directory: true, multiple: false, defaultPath: getState().rootDir ?? undefined });

  if (typeof picked === "string") {
    setRootDir(picked);
  }
}

export function setRootDir(dir: string, showPanel = true): void {
  const normalized = normalizePath(dir);
  useApp.setState((state) => ({
    rootDir: normalized,
    treeVersion: state.treeVersion + 1,
    sidebarPanel: showPanel ? "files" : state.sidebarPanel,
  }));

  if (showPanel) {
    updateSettings({ sidebarOpen: true });
  }

  pushRecentFolder(normalized);
  void ipc.allowAssetDir(normalized).catch(() => undefined);
  persistSession();
}

export function refreshTree(): void {
  useApp.setState((state) => ({ treeVersion: state.treeVersion + 1 }));
}

function suggestedName(tab: Tab): string {
  const text = editor.text(tab.id);
  const heading = /^#{1,6}\s+(.+)$/m.exec(text)?.[1] ?? text.split("\n").find((line) => line.trim() !== "") ?? "";
  const cleaned = heading.replace(/[<>:"/\\|?*#`[\]]/g, "").trim().slice(0, 60);

  return `${cleaned === "" ? "제목 없음" : cleaned}.md`;
}

export async function saveTab(id: string, saveAs = false): Promise<boolean> {
  const tab = getState().tabs.find((t) => t.id === id);

  if (tab === undefined) {
    return false;
  }

  let path = tab.path;

  if (path === null || saveAs) {
    const folder = tab.path === null ? getState().rootDir : dirname(tab.path);
    const name = tab.path === null ? suggestedName(tab) : basename(tab.path);

    const picked = await saveDialog({
      defaultPath: folder === null ? name : `${folder}\\${name}`,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: "텍스트", extensions: ["txt"] },
      ],
    });

    if (picked === null) {
      return false;
    }

    path = picked;
  }

  const doc = editor.doc(id);

  if (doc === null) {
    return false;
  }

  try {
    const result = await ipc.writeDocument(path, doc.toString(), tab.encoding, tab.eol);
    editor.markSaved(id, doc);
    const pathChanged = tab.path === null || !samePath(tab.path, path);

    if (pathChanged) {
      if (tab.path !== null) {
        void ipc.unwatchFile(tab.path).catch(() => undefined);
      }

      void ipc.watchFile(path).catch(() => undefined);
      void ipc.allowAssetDir(dirname(path)).catch(() => undefined);
      pushRecent(path);
    }

    updateTab(id, {
      path,
      title: basename(path),
      dirty: editor.isDirty(id),
      encoding: result.encoding,
      mtimeMs: result.mtimeMs,
      conflict: false,
      missing: false,
    });

    if (result.encodingChanged) {
      toast(`${tab.encoding.toUpperCase()}로 표현할 수 없는 문자가 있어 UTF-8로 저장했습니다.`, "info", 6000);
    }

    if (pathChanged) {
      preview.invalidate();
      persistSession();

      if (getState().rootDir === null) {
        setRootDir(dirname(path), false);
      } else {
        refreshTree();
      }
    }

    syncWindowTitle();

    return true;
  } catch (cause) {
    toast(`저장하지 못했습니다. ${errorText(cause)}`, "error", 7000);

    return false;
  }
}

export async function saveActive(saveAs = false): Promise<void> {
  const tab = activeTab();

  if (tab !== null) {
    await saveTab(tab.id, saveAs);
  }
}

export async function saveAll(): Promise<void> {
  for (const tab of getState().tabs) {
    if (tab.dirty || tab.path === null) {
      if (tab.path === null && editor.text(tab.id) === "") {
        continue;
      }

      await saveTab(tab.id);
    }
  }
}

/** Asks about unsaved changes. Returns false if the user cancelled. */
async function confirmDiscard(tab: Tab): Promise<boolean> {
  if (!tab.dirty) {
    return true;
  }

  activateTab(tab.id);

  const { button } = await ask({
    title: "변경 내용을 저장할까요?",
    message: `'${tab.title}'에 저장하지 않은 변경 내용이 있습니다. 저장하지 않으면 사라집니다.`,
    input: null,
    buttons: [
      { id: "cancel", label: "취소" },
      { id: "discard", label: "저장 안 함", kind: "danger" },
      { id: "save", label: "저장", kind: "primary" },
    ],
  });

  if (button === "save") {
    return saveTab(tab.id);
  }

  return button === "discard";
}

function removeTab(id: string): void {
  const state = getState();
  const index = state.tabs.findIndex((t) => t.id === id);
  const tab = state.tabs[index];

  if (tab === undefined) {
    return;
  }

  if (tab.path !== null) {
    closedPaths.push(tab.path);
    void ipc.unwatchFile(tab.path).catch(() => undefined);
  }

  const tabs = state.tabs.filter((t) => t.id !== id);
  editor.close(id);
  useApp.setState({ tabs });

  if (state.activeId === id) {
    const neighbor = tabs[Math.min(index, tabs.length - 1)];
    activateTab(neighbor?.id ?? null);
  } else {
    persistSession();
  }
}

export async function closeTab(id: string): Promise<boolean> {
  const tab = getState().tabs.find((t) => t.id === id);

  if (tab === undefined || !(await confirmDiscard(tab))) {
    return false;
  }

  removeTab(id);

  return true;
}

export async function closeOtherTabs(keepId: string): Promise<void> {
  for (const tab of getState().tabs) {
    if (tab.id !== keepId && !(await closeTab(tab.id))) {
      return;
    }
  }
}

export async function closeAllTabs(): Promise<void> {
  for (const tab of getState().tabs) {
    if (!(await closeTab(tab.id))) {
      return;
    }
  }
}

export async function reopenClosedTab(): Promise<void> {
  const path = closedPaths.pop();

  if (path !== undefined) {
    await openFile(path);
  }
}

export function cycleTab(step: 1 | -1): void {
  const { tabs, activeId } = getState();

  if (tabs.length < 2) {
    return;
  }

  const index = tabs.findIndex((t) => t.id === activeId);
  const next = tabs[(index + step + tabs.length) % tabs.length];

  if (next !== undefined) {
    activateTab(next.id);
  }
}

// ---------------------------------------------------------------- view

export function setViewMode(mode: ViewMode): void {
  useApp.setState({ viewMode: mode });
  preview.setVisible(mode !== "edit");
  persistSession();
  requestAnimationFrame(() => {
    editor.requestMeasure();

    if (mode === "split") {
      preview.syncFromEditor();
    }

    if (mode !== "preview") {
      editor.focus();
    }
  });
}

export function toggleSplit(): void {
  setViewMode(getState().viewMode === "split" ? "edit" : "split");
}

export function togglePreviewOnly(): void {
  setViewMode(getState().viewMode === "preview" ? "split" : "preview");
}

export function updateSettings(patch: Partial<Settings>): void {
  const settings = { ...getState().settings, ...patch };
  useApp.setState({ settings });
  saveItem("settings", JSON.stringify(settings));
}

export function toggleSidebar(panel?: SidebarPanel): void {
  const state = getState();

  if (panel !== undefined && (!state.settings.sidebarOpen || state.sidebarPanel !== panel)) {
    useApp.setState({ sidebarPanel: panel });
    updateSettings({ sidebarOpen: true });

    return;
  }

  updateSettings({ sidebarOpen: !state.settings.sidebarOpen });
}

export function zoom(delta: number): void {
  const { editorFontSize, previewFontSize } = getState().settings;

  if (delta === 0) {
    updateSettings({ editorFontSize: 15, previewFontSize: 16 });

    return;
  }

  updateSettings({
    editorFontSize: Math.min(32, Math.max(10, editorFontSize + delta)),
    previewFontSize: Math.min(32, Math.max(11, previewFontSize + delta)),
  });
}

export function toggleFocusMode(): void {
  const focusMode = !getState().focusMode;
  useApp.setState({ focusMode });
  void getCurrentWindow()
    .setFullscreen(focusMode)
    .catch(() => undefined);
}

// ---------------------------------------------------------------- outside changes

const changeTimers = new Map<string, number>();

/** Change events arrive in bursts (and for our own saves); settle first. */
export function queueFileChanged(path: string): void {
  const key = path.toLowerCase();
  window.clearTimeout(changeTimers.get(key));
  changeTimers.set(
    key,
    window.setTimeout(() => {
      changeTimers.delete(key);
      void handleFileChanged(path);
    }, 180),
  );
}

export async function handleFileChanged(path: string): Promise<void> {
  const tab = findTabByPath(path);

  if (tab === undefined) {
    return;
  }

  const stat = await ipc.statPath(path).catch(() => null);

  if (stat === null || !stat.exists) {
    if (!tab.missing) {
      updateTab(tab.id, { missing: true });
      toast(`'${tab.title}' 파일이 삭제되었거나 이동되었습니다. 저장하면 다시 만들어집니다.`, "info", 6000);
    }

    return;
  }

  try {
    const doc = await ipc.readDocument(path);

    // Our own save, or a touch that did not change the text.
    if (doc.content === editor.savedText(tab.id)) {
      updateTab(tab.id, { mtimeMs: doc.mtimeMs, missing: false });

      return;
    }

    if (doc.content === editor.text(tab.id)) {
      editor.markSaved(tab.id);
      updateTab(tab.id, { mtimeMs: doc.mtimeMs, missing: false, conflict: false, dirty: false });
      syncWindowTitle();

      return;
    }

    if (!tab.dirty) {
      editor.replaceContent(tab.id, doc.content);
      updateTab(tab.id, { encoding: doc.encoding, eol: doc.eol, mtimeMs: doc.mtimeMs, missing: false, dirty: false });
      preview.schedule(true);
      toast(`'${tab.title}'이(가) 다른 프로그램에서 바뀌어 다시 불러왔습니다.`);

      return;
    }

    updateTab(tab.id, { conflict: true, missing: false });
  } catch {
    // The file may be mid-write; the next change event will retry.
  }
}

export async function reloadFromDisk(id: string): Promise<void> {
  const tab = getState().tabs.find((t) => t.id === id);

  if (tab === undefined || tab.path === null) {
    return;
  }

  try {
    const doc = await ipc.readDocument(tab.path);
    editor.replaceContent(id, doc.content);
    updateTab(id, { encoding: doc.encoding, eol: doc.eol, mtimeMs: doc.mtimeMs, dirty: false, conflict: false, missing: false });
    preview.schedule(true);
    syncWindowTitle();
  } catch (cause) {
    toast(errorText(cause), "error");
  }
}

export function keepMine(id: string): void {
  updateTab(id, { conflict: false });
}

// ---------------------------------------------------------------- editor glue

export function onDocChanged(tabId: string, dirty: boolean): void {
  const tab = getState().tabs.find((t) => t.id === tabId);

  if (tab !== undefined && tab.dirty !== dirty) {
    updateTab(tabId, { dirty });
    syncWindowTitle();
  }

  preview.schedule();
  refreshStats();
  scheduleAutoSave();
}

let autoSaveTimer = 0;

function scheduleAutoSave(): void {
  if (getState().settings.autoSave !== "delay") {
    return;
  }

  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(() => {
    for (const tab of getState().tabs) {
      if (tab.dirty && tab.path !== null && !tab.conflict) {
        void saveTab(tab.id);
      }
    }
  }, 1200);
}

export function onEditorBlur(): void {
  if (getState().settings.autoSave !== "blur") {
    return;
  }

  for (const tab of getState().tabs) {
    if (tab.dirty && tab.path !== null && !tab.conflict) {
      void saveTab(tab.id);
    }
  }
}

export function toggleTaskAtLine(line: number): void {
  const tab = activeTab();
  const doc = tab === null ? null : editor.doc(tab.id);

  if (doc === null) {
    return;
  }

  const change = taskToggleChange(doc, line);

  if (change !== null) {
    editor.change(change, "input.task");
    preview.schedule(true);
  }
}

export function jumpToSource(line: number): void {
  if (!Number.isFinite(line)) {
    return;
  }

  if (getState().viewMode === "preview") {
    setViewMode("split");
  }

  requestAnimationFrame(() => editor.goToLine(line));
}

export function goToHeading(line: number): void {
  if (getState().viewMode !== "preview") {
    editor.goToLine(line);
  }

  preview.scrollToLine(line);
}

export async function followLink(href: string): Promise<void> {
  if (href === "") {
    return;
  }

  if (href.startsWith("#")) {
    preview.scrollToAnchor(safeDecode(href.slice(1)));

    return;
  }

  if (isExternalUrl(href) || /^www\./i.test(href)) {
    const url = /^www\./i.test(href) ? `https://${href}` : href;
    await openUrl(url).catch((cause: unknown) => toast(errorText(cause), "error"));

    return;
  }

  const tab = activeTab();
  const base = tab?.path === null || tab === null ? getState().rootDir : dirname(tab.path);
  const local = resolveLocalTarget(href, base);

  if (local === null) {
    toast("이 링크는 열 수 없습니다.", "error");

    return;
  }

  const hashIndex = href.indexOf("#");
  const anchor = hashIndex >= 0 ? safeDecode(href.slice(hashIndex + 1)) : undefined;
  const stat = await ipc.statPath(local).catch(() => null);

  if (stat === null || !stat.exists) {
    toast(`파일을 찾을 수 없습니다: ${local}`, "error");

    return;
  }

  if (stat.isDir) {
    setRootDir(local);

    return;
  }

  if (isMarkdownPath(local) || /\.(txt|text)$/i.test(local)) {
    await openFile(local, anchor === undefined ? {} : { anchor });

    return;
  }

  await ipc.openWithDefault(local).catch((cause: unknown) => toast(errorText(cause), "error"));
}

function stamp(): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");

  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

const IMAGE_TYPES: Partial<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

async function ensureSaved(reason: string): Promise<Tab | null> {
  const tab = activeTab();

  if (tab === null) {
    return null;
  }

  if (tab.path !== null) {
    return tab;
  }

  toast(reason);

  if (!(await saveTab(tab.id))) {
    return null;
  }

  return activeTab();
}

export async function pasteImage(file: File): Promise<void> {
  const tab = await ensureSaved("이미지를 문서 옆 폴더에 저장하려면 먼저 문서를 저장하세요.");

  if (tab === null || tab.path === null) {
    return;
  }

  const ext = IMAGE_TYPES[file.type] ?? "png";
  const name = `${stem(tab.path)}-${stamp()}.${ext}`;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const rel = await ipc.saveImage(tab.path, getState().settings.imageFolder, name, bytes);
    editor.run(insertImageLink(encodeLinkPath(rel), ""));
    toast(`이미지를 ${rel}에 저장했습니다.`, "success");
  } catch (cause) {
    toast(`이미지를 저장하지 못했습니다. ${errorText(cause)}`, "error");
  }
}

function linkTargetFor(docPath: string | null, target: string): string {
  if (docPath !== null) {
    const rel = relativePath(dirname(docPath), target);

    if (rel !== null) {
      return encodeLinkPath(rel);
    }
  }

  return `file:///${encodeLinkPath(target.replace(/\\/g, "/"))}`;
}

export async function insertImageFromDialog(): Promise<void> {
  const tab = activeTab();

  if (tab === null) {
    return;
  }

  const picked = await openDialog({
    multiple: false,
    directory: false,
    defaultPath: tab.path === null ? undefined : dirname(tab.path),
    filters: [{ name: "이미지", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"] }],
  });

  if (typeof picked !== "string") {
    return;
  }

  editor.run(insertImageLink(linkTargetFor(tab.path, picked), stem(picked)));
}

export async function handleDrop(paths: string[]): Promise<void> {
  const tab = activeTab();

  for (const path of paths) {
    const stat = await ipc.statPath(path).catch(() => null);

    if (stat === null || !stat.exists) {
      continue;
    }

    if (stat.isDir) {
      setRootDir(path);
      continue;
    }

    if (isImagePath(path) && tab !== null) {
      editor.run(insertImageLink(linkTargetFor(tab.path, path), stem(path)));
      continue;
    }

    await openFile(path);
  }
}

export function insertLinkToFile(path: string): void {
  const tab = activeTab();

  if (tab === null) {
    return;
  }

  const target = linkTargetFor(tab.path, path);
  editor.insertText(isImagePath(path) ? `![${stem(path)}](${target})` : `[${stem(path)}](${target})`);
}

// ---------------------------------------------------------------- export

async function exportBody(): Promise<{ tab: Tab; body: string } | null> {
  const tab = activeTab();

  if (tab === null) {
    return null;
  }

  const base = tab.path === null ? null : dirname(tab.path);
  const body = await renderForExport(editor.text(tab.id), base, getState().settings.previewBreaks);

  return { tab, body };
}

export async function exportHtml(): Promise<void> {
  const result = await exportBody();

  if (result === null) {
    return;
  }

  const { tab, body } = result;
  const name = `${tab.path === null ? stem(suggestedName(tab)) : stem(tab.path)}.html`;
  const folder = tab.path === null ? getState().rootDir : dirname(tab.path);

  const target = await saveDialog({
    defaultPath: folder === null ? name : `${folder}\\${name}`,
    filters: [{ name: "HTML", extensions: ["html", "htm"] }],
  });

  if (target === null) {
    return;
  }

  try {
    await ipc.writeText(target, standaloneHtml(stem(name), body));
    toast(`HTML로 내보냈습니다: ${basename(target)}`, "success");
  } catch (cause) {
    toast(`내보내지 못했습니다. ${errorText(cause)}`, "error");
  }
}

export async function copyAsRichText(): Promise<void> {
  const result = await exportBody();

  if (result === null) {
    return;
  }

  const text = editor.text(result.tab.id);

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([result.body], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    toast("서식 있는 텍스트로 복사했습니다. 블로그·메일·문서에 바로 붙여 넣을 수 있습니다.", "success");
  } catch (cause) {
    toast(`복사하지 못했습니다. ${errorText(cause)}`, "error");
  }
}

export async function copyHtmlSource(): Promise<void> {
  const result = await exportBody();

  if (result === null) {
    return;
  }

  await navigator.clipboard.writeText(result.body);
  toast("HTML 코드를 복사했습니다.", "success");
}

export async function printToPdf(): Promise<void> {
  const tab = activeTab();

  if (tab === null) {
    return;
  }

  const previous = getState().viewMode;
  document.documentElement.classList.add("printing");

  if (previous === "edit") {
    setViewMode("split");
  }

  preview.invalidate();
  await new Promise((resolve) => window.setTimeout(resolve, 450));

  const restore = () => {
    document.documentElement.classList.remove("printing");

    if (previous === "edit") {
      setViewMode("edit");
    }

    window.removeEventListener("afterprint", restore);
  };

  window.addEventListener("afterprint", restore);
  window.print();
}

// ---------------------------------------------------------------- files

export async function revealInExplorer(path: string): Promise<void> {
  await revealItemInDir(path).catch((cause: unknown) => toast(errorText(cause), "error"));
}

export async function copyText(text: string, message: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  toast(message, "success", 1800);
}

export async function createFileIn(dir: string): Promise<void> {
  const { button, value } = await ask({
    title: "새 Markdown 파일",
    message: `${dir} 폴더에 만듭니다.`,
    input: { value: "새 문서.md", placeholder: "파일 이름", selectStem: true },
    buttons: [
      { id: "cancel", label: "취소" },
      { id: "ok", label: "만들기", kind: "primary" },
    ],
  });

  if (button !== "ok" || value.trim() === "") {
    return;
  }

  const name = /\.[a-z0-9]+$/i.test(value.trim()) ? value.trim() : `${value.trim()}.md`;

  try {
    const path = await ipc.createFile(dir, name);
    refreshTree();
    await openFile(path);
  } catch (cause) {
    toast(errorText(cause), "error");
  }
}

export async function createFolderIn(dir: string): Promise<void> {
  const { button, value } = await ask({
    title: "새 폴더",
    message: `${dir} 폴더 안에 만듭니다.`,
    input: { value: "새 폴더", placeholder: "폴더 이름", selectStem: false },
    buttons: [
      { id: "cancel", label: "취소" },
      { id: "ok", label: "만들기", kind: "primary" },
    ],
  });

  if (button !== "ok" || value.trim() === "") {
    return;
  }

  try {
    await ipc.createDir(dir, value.trim());
    refreshTree();
  } catch (cause) {
    toast(errorText(cause), "error");
  }
}

export async function renameEntry(path: string): Promise<void> {
  const { button, value } = await ask({
    title: "이름 바꾸기",
    message: path,
    input: { value: basename(path), placeholder: "새 이름", selectStem: true },
    buttons: [
      { id: "cancel", label: "취소" },
      { id: "ok", label: "바꾸기", kind: "primary" },
    ],
  });

  if (button !== "ok" || value.trim() === "" || value.trim() === basename(path)) {
    return;
  }

  try {
    const renamed = await ipc.renamePath(path, value.trim());
    const tab = findTabByPath(path);

    if (tab !== undefined) {
      void ipc.unwatchFile(path).catch(() => undefined);
      void ipc.watchFile(renamed).catch(() => undefined);
      updateTab(tab.id, { path: renamed, title: basename(renamed) });
      syncWindowTitle();
      persistSession();
    }

    refreshTree();
  } catch (cause) {
    toast(errorText(cause), "error");
  }
}

export function setEncoding(encoding: string): void {
  const tab = activeTab();

  if (tab === null) {
    return;
  }

  updateTab(tab.id, { encoding, dirty: true });
  syncWindowTitle();
  toast(`저장할 때 ${encoding.toUpperCase()}(으)로 저장합니다.`);
}

export function toggleEol(): void {
  const tab = activeTab();

  if (tab === null) {
    return;
  }

  updateTab(tab.id, { eol: tab.eol === "crlf" ? "lf" : "crlf", dirty: true });
  syncWindowTitle();
}

// ---------------------------------------------------------------- default app

export async function checkDefaultApp(): Promise<void> {
  try {
    const status = await ipc.associationStatus();
    useApp.setState({ isDefaultApp: status.isDefault, assocNeedsConfirm: status.needsConfirm });
  } catch {
    useApp.setState({ isDefaultApp: null });
  }
}

export async function makeDefaultApp(): Promise<void> {
  try {
    const status = await ipc.makeDefaultApp();
    useApp.setState({ isDefaultApp: status.isDefault, assocNeedsConfirm: status.needsConfirm });

    if (status.isDefault) {
      toast("이제 모든 Markdown 파일이 ChoiMark로 열립니다.", "success", 4500);
    } else if (status.needsConfirm) {
      toast(
        "Windows 11은 마지막 확인을 직접 하게 되어 있습니다. 열린 설정 창에서 .md를 누르고 ChoiMark를 고르세요. .md 파일을 처음 열 때 나오는 창에서 ChoiMark를 골라도 됩니다.",
        "info",
        12000,
      );
    } else {
      toast(`일부 확장자는 연결되지 않았습니다: ${status.unlinked.join(", ")}`, "error", 7000);
    }
  } catch (cause) {
    toast(`기본 앱으로 설정하지 못했습니다. ${errorText(cause)}`, "error");
  }
}

// ---------------------------------------------------------------- lifecycle

export async function requestClose(): Promise<void> {
  const dirty = getState().tabs.filter((tab) => tab.dirty);

  if (dirty.length > 0) {
    const { button } = await ask({
      title: "저장하지 않은 문서가 있습니다",
      message:
        dirty.length === 1
          ? `'${dirty[0]?.title ?? ""}'의 변경 내용을 저장할까요?`
          : `${dirty.length}개 문서에 저장하지 않은 변경 내용이 있습니다. 모두 저장할까요?`,
      input: null,
      buttons: [
        { id: "cancel", label: "취소" },
        { id: "discard", label: "저장 안 함", kind: "danger" },
        { id: "save", label: dirty.length === 1 ? "저장" : "모두 저장", kind: "primary" },
      ],
    });

    if (button === "cancel") {
      return;
    }

    if (button === "save") {
      for (const tab of dirty) {
        if (!(await saveTab(tab.id))) {
          return;
        }
      }
    }
  }

  window.clearTimeout(sessionTimer);
  writeSession();
  await getCurrentWindow().destroy();
}

export async function restoreSession(): Promise<void> {
  const settings = getState().settings;
  const session = parseSession(loadItem("session"));

  if (session.viewMode !== null) {
    setViewMode(session.viewMode);
  }

  if (session.rootDir !== null) {
    const stat = await ipc.statPath(session.rootDir).catch(() => null);

    if (stat?.exists === true && stat.isDir) {
      setRootDir(session.rootDir, false);
    }
  }

  if (!settings.restoreSession) {
    return;
  }

  for (const path of session.paths) {
    await openFile(path, { quiet: true });
  }

  if (session.active !== null) {
    const tab = findTabByPath(session.active);

    if (tab !== undefined) {
      activateTab(tab.id);
    }
  }
}

export function showPanel(panel: SidebarPanel): void {
  toggleSidebar(panel);
}
