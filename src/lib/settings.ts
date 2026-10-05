export type ThemeSetting = "system" | "light" | "dark";
export type ViewMode = "edit" | "split" | "preview";
export type EditorFont = "d2coding" | "jetbrains" | "sans";
export type PreviewWidth = "narrow" | "normal" | "wide" | "full";
export type AutoSave = "off" | "delay" | "blur";
export type FileFilter = "markdown" | "all";

export interface Settings {
  theme: ThemeSetting;
  editorFont: EditorFont;
  editorFontSize: number;
  previewFontSize: number;
  previewWidth: PreviewWidth;
  lineNumbers: boolean;
  wordWrap: boolean;
  highlightActiveLine: boolean;
  tabSize: number;
  spellcheck: boolean;
  syncScroll: boolean;
  previewBreaks: boolean;
  autoSave: AutoSave;
  restoreSession: boolean;
  imageFolder: string;
  defaultViewMode: ViewMode;
  fileFilter: FileFilter;
  splitRatio: number;
  sidebarWidth: number;
  sidebarOpen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  editorFont: "d2coding",
  editorFontSize: 15,
  previewFontSize: 16,
  previewWidth: "normal",
  lineNumbers: true,
  wordWrap: true,
  highlightActiveLine: true,
  tabSize: 2,
  spellcheck: false,
  syncScroll: true,
  previewBreaks: false,
  autoSave: "off",
  restoreSession: true,
  imageFolder: "assets",
  defaultViewMode: "split",
  fileFilter: "markdown",
  splitRatio: 0.5,
  sidebarWidth: 264,
  sidebarOpen: true,
};

function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return options.some((option) => option === value);
}

function isBoolean(value: unknown): value is boolean {
  return value === true || value === false;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Boundary parser for the stored settings JSON. Unknown or broken fields fall back to defaults. */
export function parseSettings(text: string | null): Settings {
  const result: Settings = { ...DEFAULT_SETTINGS };

  if (text === null) {
    return result;
  }

  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    return result;
  }

  if (typeof raw !== "object" || raw === null) {
    return result;
  }

  if ("theme" in raw && isOneOf(["system", "light", "dark"] as const, raw.theme)) {
    result.theme = raw.theme;
  }

  if ("editorFont" in raw && isOneOf(["d2coding", "jetbrains", "sans"] as const, raw.editorFont)) {
    result.editorFont = raw.editorFont;
  }

  if ("editorFontSize" in raw && isFiniteNumber(raw.editorFontSize)) {
    result.editorFontSize = clamp(Math.round(raw.editorFontSize), 10, 32);
  }

  if ("previewFontSize" in raw && isFiniteNumber(raw.previewFontSize)) {
    result.previewFontSize = clamp(Math.round(raw.previewFontSize), 11, 32);
  }

  if ("previewWidth" in raw && isOneOf(["narrow", "normal", "wide", "full"] as const, raw.previewWidth)) {
    result.previewWidth = raw.previewWidth;
  }

  if ("lineNumbers" in raw && isBoolean(raw.lineNumbers)) {
    result.lineNumbers = raw.lineNumbers;
  }

  if ("wordWrap" in raw && isBoolean(raw.wordWrap)) {
    result.wordWrap = raw.wordWrap;
  }

  if ("highlightActiveLine" in raw && isBoolean(raw.highlightActiveLine)) {
    result.highlightActiveLine = raw.highlightActiveLine;
  }

  if ("tabSize" in raw && isFiniteNumber(raw.tabSize)) {
    result.tabSize = clamp(Math.round(raw.tabSize), 1, 8);
  }

  if ("spellcheck" in raw && isBoolean(raw.spellcheck)) {
    result.spellcheck = raw.spellcheck;
  }

  if ("syncScroll" in raw && isBoolean(raw.syncScroll)) {
    result.syncScroll = raw.syncScroll;
  }

  if ("previewBreaks" in raw && isBoolean(raw.previewBreaks)) {
    result.previewBreaks = raw.previewBreaks;
  }

  if ("autoSave" in raw && isOneOf(["off", "delay", "blur"] as const, raw.autoSave)) {
    result.autoSave = raw.autoSave;
  }

  if ("restoreSession" in raw && isBoolean(raw.restoreSession)) {
    result.restoreSession = raw.restoreSession;
  }

  if ("imageFolder" in raw && isText(raw.imageFolder) && raw.imageFolder.trim() !== "") {
    result.imageFolder = raw.imageFolder.trim();
  }

  if ("defaultViewMode" in raw && isOneOf(["edit", "split", "preview"] as const, raw.defaultViewMode)) {
    result.defaultViewMode = raw.defaultViewMode;
  }

  if ("fileFilter" in raw && isOneOf(["markdown", "all"] as const, raw.fileFilter)) {
    result.fileFilter = raw.fileFilter;
  }

  if ("splitRatio" in raw && isFiniteNumber(raw.splitRatio)) {
    result.splitRatio = clamp(raw.splitRatio, 0.2, 0.8);
  }

  if ("sidebarWidth" in raw && isFiniteNumber(raw.sidebarWidth)) {
    result.sidebarWidth = clamp(Math.round(raw.sidebarWidth), 180, 520);
  }

  if ("sidebarOpen" in raw && isBoolean(raw.sidebarOpen)) {
    result.sidebarOpen = raw.sidebarOpen;
  }

  return result;
}

export interface Session {
  paths: string[];
  active: string | null;
  rootDir: string | null;
  viewMode: ViewMode | null;
}

export function parseSession(text: string | null): Session {
  const empty: Session = { paths: [], active: null, rootDir: null, viewMode: null };

  if (text === null) {
    return empty;
  }

  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    return empty;
  }

  if (typeof raw !== "object" || raw === null) {
    return empty;
  }

  const session = { ...empty };

  if ("paths" in raw && Array.isArray(raw.paths)) {
    session.paths = raw.paths.filter(isText);
  }

  if ("active" in raw && isText(raw.active)) {
    session.active = raw.active;
  }

  if ("rootDir" in raw && isText(raw.rootDir)) {
    session.rootDir = raw.rootDir;
  }

  if ("viewMode" in raw && isOneOf(["edit", "split", "preview"] as const, raw.viewMode)) {
    session.viewMode = raw.viewMode;
  }

  return session;
}

export function parseStringList(text: string | null): string[] {
  if (text === null) {
    return [];
  }

  try {
    const raw: unknown = JSON.parse(text);

    return Array.isArray(raw) ? raw.filter(isText) : [];
  } catch {
    return [];
  }
}

const KEYS = {
  settings: "choimark.settings",
  session: "choimark.session",
  recent: "choimark.recent",
  recentFolders: "choimark.recentFolders",
} as const;

export type StorageKey = keyof typeof KEYS;

// localStorage can throw (quota, disabled storage); settings are a
// convenience, so failures are swallowed rather than surfaced.
export function loadItem(key: StorageKey): string | null {
  try {
    return window.localStorage.getItem(KEYS[key]);
  } catch {
    return null;
  }
}

export function saveItem(key: StorageKey, value: string): void {
  try {
    window.localStorage.setItem(KEYS[key], value);
  } catch {
    // ignore
  }
}
