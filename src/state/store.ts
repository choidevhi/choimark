import { create } from "zustand";

import type { Eol, PlatformInfo } from "../lib/ipc";
import type { Heading } from "../lib/markdown";
import { loadItem, parseSettings, parseStringList, type Settings, type ViewMode } from "../lib/settings";

export type SidebarPanel = "files" | "outline" | "search";
export type PaletteMode = "commands" | "files" | "outline";

export interface Tab {
  id: string;
  path: string | null;
  title: string;
  dirty: boolean;
  encoding: string;
  eol: Eol;
  mtimeMs: number;
  readonly: boolean;
  /** Changed on disk while it had unsaved edits. */
  conflict: boolean;
  missing: boolean;
}

export interface CursorInfo {
  line: number;
  column: number;
  selected: number;
}

export interface DocStats {
  words: number;
  chars: number;
  charsNoSpace: number;
  lines: number;
}

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface DialogButton {
  id: string;
  label: string;
  kind?: "primary" | "danger" | "default";
}

export interface DialogRequest {
  title: string;
  message: string;
  input: { value: string; placeholder: string; selectStem: boolean } | null;
  buttons: DialogButton[];
  resolve: (result: { button: string; value: string }) => void;
}

export interface MenuItem {
  label: string;
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

export type MenuEntry = MenuItem | "separator";

export interface MenuRequest {
  x: number;
  y: number;
  items: MenuEntry[];
}

export interface AppState {
  tabs: Tab[];
  activeId: string | null;
  viewMode: ViewMode;
  sidebarPanel: SidebarPanel;
  rootDir: string | null;
  treeVersion: number;
  outline: Heading[];
  activeHeading: number;
  cursor: CursorInfo;
  stats: DocStats;
  palette: PaletteMode | null;
  settingsOpen: boolean;
  dialog: DialogRequest | null;
  toasts: Toast[];
  menu: MenuRequest | null;
  dragOver: boolean;
  maximized: boolean;
  focusMode: boolean;
  settings: Settings;
  recent: string[];
  recentFolders: string[];
  platform: PlatformInfo | null;
  isDefaultApp: boolean | null;
  assocNeedsConfirm: boolean;
}

const initialSettings = parseSettings(loadItem("settings"));

export const useApp = create<AppState>(() => ({
  tabs: [],
  activeId: null,
  viewMode: initialSettings.defaultViewMode,
  sidebarPanel: "files",
  rootDir: null,
  treeVersion: 0,
  outline: [],
  activeHeading: -1,
  cursor: { line: 1, column: 1, selected: 0 },
  stats: { words: 0, chars: 0, charsNoSpace: 0, lines: 1 },
  palette: null,
  settingsOpen: false,
  dialog: null,
  toasts: [],
  menu: null,
  dragOver: false,
  maximized: false,
  focusMode: false,
  settings: initialSettings,
  recent: parseStringList(loadItem("recent")),
  recentFolders: parseStringList(loadItem("recentFolders")),
  platform: null,
  isDefaultApp: null,
  assocNeedsConfirm: false,
}));

export function getState(): AppState {
  return useApp.getState();
}

export function activeTab(): Tab | null {
  const { tabs, activeId } = useApp.getState();

  return tabs.find((tab) => tab.id === activeId) ?? null;
}

export function updateTab(id: string, patch: Partial<Tab>): void {
  useApp.setState((state) => ({
    tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)),
  }));
}

let toastSeq = 0;

export function toast(text: string, kind: ToastKind = "info", ms = 3200): void {
  toastSeq += 1;
  const id = toastSeq;
  useApp.setState((state) => ({ toasts: [...state.toasts.slice(-3), { id, kind, text }] }));
  window.setTimeout(() => {
    useApp.setState((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  }, ms);
}

export function ask(request: Omit<DialogRequest, "resolve">): Promise<{ button: string; value: string }> {
  return new Promise((resolve) => {
    useApp.setState({
      dialog: {
        ...request,
        resolve: (result) => {
          useApp.setState({ dialog: null });
          resolve(result);
        },
      },
    });
  });
}

export function openMenu(event: { clientX: number; clientY: number }, items: MenuEntry[]): void {
  useApp.setState({ menu: { x: event.clientX, y: event.clientY, items } });
}
