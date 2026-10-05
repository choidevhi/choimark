import { invoke } from "@tauri-apps/api/core";

export type Eol = "lf" | "crlf";

export interface DocFile {
  path: string;
  content: string;
  encoding: string;
  eol: Eol;
  mtimeMs: number;
  readonly: boolean;
}

export interface WriteResult {
  encoding: string;
  mtimeMs: number;
  encodingChanged: boolean;
}

export interface PathStat {
  exists: boolean;
  isDir: boolean;
  mtimeMs: number;
  size: number;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface SearchHit {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface SearchResult {
  hits: SearchHit[];
  filesScanned: number;
  truncated: boolean;
}

export interface AssocStatus {
  isDefault: boolean;
  /** Windows 11 Home/Pro: the user must pick ChoiMark once in Windows' own UI. */
  needsConfirm: boolean;
  handler: string;
  handlerName: string;
  linked: string[];
  unlinked: string[];
}

export interface PlatformInfo {
  build: number;
  version: string;
}

export const ipc = {
  takeStartupPaths: () => invoke<string[]>("take_startup_paths"),
  readDocument: (path: string) => invoke<DocFile>("read_document", { path }),
  writeDocument: (path: string, content: string, encoding: string, eol: Eol) =>
    invoke<WriteResult>("write_document", { path, content, encoding, eol }),
  writeText: (path: string, content: string) => invoke<void>("write_text", { path, content }),
  statPath: (path: string) => invoke<PathStat>("stat_path", { path }),
  listDir: (path: string, allFiles: boolean) => invoke<DirEntry[]>("list_dir", { path, allFiles }),
  listMarkdownFiles: (root: string) => invoke<string[]>("list_markdown_files", { root }),
  searchInDir: (root: string, query: string, caseSensitive: boolean) =>
    invoke<SearchResult>("search_in_dir", { root, query, caseSensitive }),
  saveImage: (docPath: string, folder: string, fileName: string, bytes: Uint8Array) =>
    invoke<string>("save_image", bytes, {
      headers: {
        "x-doc-path": encodeURIComponent(docPath),
        "x-folder": encodeURIComponent(folder),
        "x-file-name": encodeURIComponent(fileName),
      },
    }),
  createFile: (dir: string, name: string) => invoke<string>("create_file", { dir, name }),
  createDir: (dir: string, name: string) => invoke<string>("create_dir", { dir, name }),
  renamePath: (path: string, newName: string) => invoke<string>("rename_path", { path, newName }),
  openWithDefault: (path: string) => invoke<void>("open_with_default", { path }),
  allowAssetDir: (dir: string) => invoke<void>("allow_asset_dir", { dir }),
  watchFile: (path: string) => invoke<void>("watch_file", { path }),
  unwatchFile: (path: string) => invoke<void>("unwatch_file", { path }),
  associationStatus: () => invoke<AssocStatus>("association_status"),
  makeDefaultApp: () => invoke<AssocStatus>("make_default_app"),
  platformInfo: () => invoke<PlatformInfo>("platform_info"),
};

export function errorText(cause: unknown): string {
  if (typeof cause === "string") {
    return cause;
  }

  if (cause instanceof Error) {
    return cause.message;
  }

  return String(cause);
}
