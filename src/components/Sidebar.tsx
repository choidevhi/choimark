import { ArrowUp, ChevronRight, CaseSensitive, FilePlus, FileText, Folder, FolderOpen, FolderPlus, ListTree, RefreshCw, Search, Files, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";

import {
  copyText,
  createFileIn,
  createFolderIn,
  goToHeading,
  insertLinkToFile,
  openFile,
  openFolderDialog,
  refreshTree,
  renameEntry,
  revealInExplorer,
  setRootDir,
  updateSettings,
} from "../app/actions";
import { errorText, ipc, type DirEntry, type SearchResult } from "../lib/ipc";
import { basename, dirname, isMarkdownPath, relativePath, samePath } from "../lib/paths";
import { activeTab, getState, openMenu, toast, useApp, type MenuEntry, type SidebarPanel } from "../state/store";
import { IconButton, cx } from "./ui";

const ICON = { size: 15, strokeWidth: 1.9 } as const;

function entryMenu(event: MouseEvent, entry: DirEntry) {
  event.preventDefault();
  event.stopPropagation();
  const folder = entry.isDir ? entry.path : dirname(entry.path);
  const items: MenuEntry[] = [];

  if (entry.isDir) {
    items.push({ label: "이 폴더를 루트로", run: () => setRootDir(entry.path) });
    items.push({ label: "새 파일…", run: () => void createFileIn(folder) });
    items.push({ label: "새 폴더…", run: () => void createFolderIn(folder) });
  } else {
    items.push({ label: "열기", run: () => void openFile(entry.path) });
    items.push({ label: "현재 문서에 링크 넣기", disabled: activeTab() === null, run: () => insertLinkToFile(entry.path) });
  }

  items.push("separator");
  items.push({ label: "이름 바꾸기…", keys: "F2", run: () => void renameEntry(entry.path) });
  items.push({ label: "경로 복사", run: () => void copyText(entry.path, "경로를 복사했습니다.") });
  items.push({ label: "탐색기에서 보기", run: () => void revealInExplorer(entry.path) });
  openMenu(event, items);
}

function TreeNode({ entry, depth, version }: { entry: DirEntry; depth: number; version: number }) {
  const [open, setOpen] = useState(false);
  const activePath = useApp((s) => s.tabs.find((t) => t.id === s.activeId)?.path ?? null);
  const isActive = !entry.isDir && activePath !== null && samePath(activePath, entry.path);

  const onClick = () => {
    if (entry.isDir) {
      setOpen((value) => !value);
    } else {
      void openFile(entry.path);
    }
  };

  return (
    <li>
      <div
        className={cx("tree-row", isActive && "active", !entry.isDir && !isMarkdownPath(entry.path) && "dim")}
        style={{ paddingLeft: 10 + depth * 14 }}
        title={entry.path}
        onClick={onClick}
        onContextMenu={(event) => entryMenu(event, entry)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onClick();
          } else if (event.key === "F2") {
            void renameEntry(entry.path);
          }
        }}
        tabIndex={0}
      >
        {entry.isDir ? (
          <ChevronRight className={cx("tree-chevron", open && "open")} size={14} strokeWidth={2} />
        ) : (
          <span className="tree-chevron-space" />
        )}
        {entry.isDir ? (
          open ? <FolderOpen className="tree-icon folder" {...ICON} /> : <Folder className="tree-icon folder" {...ICON} />
        ) : (
          <FileText className="tree-icon" {...ICON} />
        )}
        <span className="tree-name">{entry.name}</span>
      </div>
      {entry.isDir && open ? <DirList path={entry.path} depth={depth + 1} version={version} /> : null}
    </li>
  );
}

function DirList({ path, depth, version }: { path: string; depth: number; version: number }) {
  const allFiles = useApp((s) => s.settings.fileFilter === "all");
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    ipc
      .listDir(path, allFiles)
      .then((list) => {
        if (alive) {
          setEntries(list);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (alive) {
          setError(errorText(cause));
        }
      });

    return () => {
      alive = false;
    };
  }, [path, allFiles, version]);

  if (error !== null) {
    return <div className="tree-empty" style={{ paddingLeft: 24 + depth * 14 }}>{error}</div>;
  }

  if (entries === null) {
    return null;
  }

  if (entries.length === 0) {
    return (
      <div className="tree-empty" style={{ paddingLeft: 24 + depth * 14 }}>
        {allFiles ? "비어 있음" : "Markdown 파일 없음"}
      </div>
    );
  }

  return (
    <ul className="tree-list">
      {entries.map((entry) => (
        <TreeNode key={entry.path} entry={entry} depth={depth} version={version} />
      ))}
    </ul>
  );
}

function FilesPanel() {
  const rootDir = useApp((s) => s.rootDir);
  const version = useApp((s) => s.treeVersion);
  const fileFilter = useApp((s) => s.settings.fileFilter);
  const recentFolders = useApp((s) => s.recentFolders);

  useEffect(() => {
    const onFocus = () => refreshTree();
    window.addEventListener("focus", onFocus);

    return () => window.removeEventListener("focus", onFocus);
  }, []);

  if (rootDir === null) {
    return (
      <div className="panel-empty">
        <FolderOpen size={28} strokeWidth={1.5} />
        <p>폴더를 열면 Markdown 파일 목록이 여기에 보입니다.</p>
        <button type="button" className="button primary" onClick={() => void openFolderDialog()}>
          폴더 열기
        </button>
        {recentFolders.length > 0 ? (
          <div className="recent-folders">
            <div className="panel-caption">최근 폴더</div>
            {recentFolders.map((dir) => (
              <button key={dir} type="button" className="recent-folder" title={dir} onClick={() => setRootDir(dir)}>
                <Folder size={14} strokeWidth={1.9} />
                <span>{basename(dir) || dir}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const parent = dirname(rootDir);

  return (
    <div className="panel-body">
      <div className="panel-toolbar">
        <button
          type="button"
          className="root-name"
          title={`${rootDir}\n(오른쪽 클릭: 메뉴)`}
          onClick={() => void openFolderDialog()}
          onContextMenu={(event) => entryMenu(event, { name: basename(rootDir), path: rootDir, isDir: true })}
        >
          <FolderOpen size={14} strokeWidth={1.9} />
          <span>{basename(rootDir) || rootDir}</span>
        </button>
        <div className="panel-actions">
          <IconButton label="새 파일" onClick={() => void createFileIn(rootDir)}>
            <FilePlus size={15} strokeWidth={1.8} />
          </IconButton>
          <IconButton label="새 폴더" onClick={() => void createFolderIn(rootDir)}>
            <FolderPlus size={15} strokeWidth={1.8} />
          </IconButton>
          <IconButton label="상위 폴더" disabled={parent === "" || samePath(parent, rootDir)} onClick={() => setRootDir(parent)}>
            <ArrowUp size={15} strokeWidth={1.8} />
          </IconButton>
          <IconButton label="새로 고침" onClick={() => refreshTree()}>
            <RefreshCw size={14} strokeWidth={1.8} />
          </IconButton>
        </div>
      </div>
      <div className="panel-scroll">
        <DirList path={rootDir} depth={0} version={version} />
      </div>
      <div className="panel-footer">
        <button
          type="button"
          className={cx("chip", fileFilter === "markdown" && "selected")}
          onClick={() => updateSettings({ fileFilter: "markdown" })}
        >
          Markdown만
        </button>
        <button
          type="button"
          className={cx("chip", fileFilter === "all" && "selected")}
          onClick={() => updateSettings({ fileFilter: "all" })}
        >
          모든 파일
        </button>
      </div>
    </div>
  );
}

function OutlinePanel() {
  const outline = useApp((s) => s.outline);
  const activeHeading = useApp((s) => s.activeHeading);
  const hasDoc = useApp((s) => s.activeId !== null);
  const listRef = useRef<HTMLUListElement>(null);
  const minLevel = useMemo(() => outline.reduce((min, h) => Math.min(min, h.level), 6), [outline]);

  useEffect(() => {
    const el = listRef.current?.querySelector(".outline-item.active");

    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeHeading]);

  if (!hasDoc || outline.length === 0) {
    return (
      <div className="panel-empty">
        <ListTree size={28} strokeWidth={1.5} />
        <p>{hasDoc ? "문서에 제목(#)이 없습니다." : "문서를 열면 목차가 보입니다."}</p>
      </div>
    );
  }

  return (
    <div className="panel-body">
      <div className="panel-scroll">
        <ul className="outline-list" ref={listRef}>
          {outline.map((heading, index) => (
            <li key={`${heading.line}-${heading.id}`}>
              <button
                type="button"
                className={cx("outline-item", `level-${heading.level}`, index === activeHeading && "active")}
                style={{ paddingLeft: 12 + (heading.level - minLevel) * 14 }}
                title={heading.text}
                onClick={() => goToHeading(heading.line)}
              >
                <span className="outline-text">{heading.text || "(빈 제목)"}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function highlightMatch(text: string, query: string, caseSensitive: boolean) {
  if (query === "") {
    return text;
  }

  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const index = hay.indexOf(needle);

  if (index < 0) {
    return text;
  }

  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

function SearchPanel() {
  const rootDir = useApp((s) => s.rootDir);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (rootDir === null || query.trim() === "") {
      setResult(null);

      return;
    }

    seq.current += 1;
    const current = seq.current;
    setBusy(true);

    const timer = window.setTimeout(() => {
      ipc
        .searchInDir(rootDir, query, caseSensitive)
        .then((found) => {
          if (current === seq.current) {
            setResult(found);
          }
        })
        .catch((cause: unknown) => toast(errorText(cause), "error"))
        .finally(() => {
          if (current === seq.current) {
            setBusy(false);
          }
        });
    }, 260);

    return () => window.clearTimeout(timer);
  }, [rootDir, query, caseSensitive]);

  const groups = useMemo(() => {
    const map = new Map<string, SearchResult["hits"]>();

    for (const hit of result?.hits ?? []) {
      const list = map.get(hit.path);

      if (list === undefined) {
        map.set(hit.path, [hit]);
      } else {
        list.push(hit);
      }
    }

    return Array.from(map.entries());
  }, [result]);

  const openHit = useCallback((path: string, line: number, column: number) => {
    void openFile(path, { line: line - 1, column: column - 1 });
  }, []);

  if (rootDir === null) {
    return (
      <div className="panel-empty">
        <Search size={28} strokeWidth={1.5} />
        <p>폴더를 열면 그 안의 모든 Markdown 문서에서 찾을 수 있습니다.</p>
        <button type="button" className="button primary" onClick={() => void openFolderDialog()}>
          폴더 열기
        </button>
      </div>
    );
  }

  return (
    <div className="panel-body">
      <div className="search-box">
        <Search size={14} strokeWidth={2} className="search-icon" />
        <input
          ref={inputRef}
          value={query}
          placeholder={`${basename(rootDir)}에서 찾기`}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            const first = result?.hits[0];

            if (event.key === "Enter" && first !== undefined) {
              openHit(first.path, first.line, first.column);
            }
          }}
        />
        {query !== "" ? (
          <button type="button" className="search-clear" aria-label="지우기" onClick={() => setQuery("")}>
            <X size={13} strokeWidth={2} />
          </button>
        ) : null}
        <IconButton label="대소문자 구분" active={caseSensitive} onClick={() => setCaseSensitive((v) => !v)}>
          <CaseSensitive size={16} strokeWidth={1.8} />
        </IconButton>
      </div>
      {result !== null ? (
        <div className="search-summary">
          {busy ? "찾는 중…" : `${groups.length}개 문서, ${result.hits.length}곳${result.truncated ? " (일부만 표시)" : ""}`}
        </div>
      ) : null}
      <div className="panel-scroll">
        {groups.map(([path, hits]) => (
          <div key={path} className="search-group">
            <div className="search-file" title={path} onClick={() => openHit(path, hits[0]?.line ?? 1, 1)}>
              <FileText size={14} strokeWidth={1.9} />
              <span className="search-file-name">{basename(path)}</span>
              <span className="search-file-dir">{relativePath(rootDir, dirname(path)) || ""}</span>
              <span className="search-count">{hits.length}</span>
            </div>
            {hits.slice(0, 50).map((hit) => (
              <button
                key={`${hit.line}:${hit.column}`}
                type="button"
                className="search-hit"
                onClick={() => openHit(hit.path, hit.line, hit.column)}
              >
                <span className="search-line">{hit.line}</span>
                <span className="search-preview">{highlightMatch(hit.preview, query, caseSensitive)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const PANELS: Array<{ id: SidebarPanel; label: string; icon: typeof Files }> = [
  { id: "files", label: "파일", icon: Files },
  { id: "outline", label: "개요", icon: ListTree },
  { id: "search", label: "검색", icon: Search },
];

export function Sidebar() {
  const panel = useApp((s) => s.sidebarPanel);
  const width = useApp((s) => s.settings.sidebarWidth);

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = getState().settings.sidebarWidth;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing");

    const move = (e: globalThis.PointerEvent) => {
      const next = Math.min(520, Math.max(180, startWidth + e.clientX - startX));
      useApp.setState((state) => ({ settings: { ...state.settings, sidebarWidth: next } }));
    };

    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
      updateSettings({ sidebarWidth: getState().settings.sidebarWidth });
    };

    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-tabs" role="tablist">
        {PANELS.map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={panel === item.id}
              className={cx("sidebar-tab", panel === item.id && "selected")}
              onClick={() => useApp.setState({ sidebarPanel: item.id })}
            >
              <Icon size={14} strokeWidth={1.9} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
      {panel === "files" ? <FilesPanel /> : null}
      {panel === "outline" ? <OutlinePanel /> : null}
      {panel === "search" ? <SearchPanel /> : null}
      <div className="sidebar-resizer" onPointerDown={startResize} onDoubleClick={() => updateSettings({ sidebarWidth: 264 })} />
    </aside>
  );
}
