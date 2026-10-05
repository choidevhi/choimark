import { ChevronRight, FileText, Hash, Search, TerminalSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { goToHeading, openFile } from "../app/actions";
import { commands } from "../app/commands";
import { ipc } from "../lib/ipc";
import { basename, dirname, pathKey, relativePath } from "../lib/paths";
import { useApp, type PaletteMode } from "../state/store";
import { Kbd, cx } from "./ui";

interface Item {
  key: string;
  title: string;
  detail?: string;
  keys?: string;
  icon: ReactNode;
  score: number;
  run: () => void;
}

/** Subsequence match; consecutive and word-start hits score higher. */
export function fuzzyScore(text: string, query: string): number {
  if (query === "") {
    return 1;
  }

  const hay = text.toLowerCase();
  const needle = query.toLowerCase().replace(/\s+/g, "");
  const direct = hay.indexOf(needle);

  if (direct >= 0) {
    return 1000 - direct * 2 - (hay.length - needle.length) * 0.1;
  }

  let score = 0;
  let last = -1;

  for (const char of needle) {
    const index = hay.indexOf(char, last + 1);

    if (index < 0) {
      return 0;
    }

    score += index === last + 1 ? 8 : 1;

    if (index === 0 || /[\s/\\._-]/.test(hay[index - 1] ?? "")) {
      score += 5;
    }

    last = index;
  }

  return score;
}

const PLACEHOLDER: Record<PaletteMode, string> = {
  commands: "명령 검색…",
  files: "파일 이름으로 찾기…",
  outline: "제목 찾기…",
};

export function CommandPalette() {
  const mode = useApp((s) => s.palette);
  const close = () => useApp.setState({ palette: null });

  if (mode === null) {
    return null;
  }

  return <PaletteBody key={mode} mode={mode} close={close} />;
}

function PaletteBody({ mode, close }: { mode: PaletteMode; close: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const rootDir = useApp((s) => s.rootDir);
  const recent = useApp((s) => s.recent);
  const outline = useApp((s) => s.outline);
  const hasDoc = useApp((s) => s.activeId !== null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode !== "files" || rootDir === null) {
      return;
    }

    let alive = true;
    void ipc
      .listMarkdownFiles(rootDir)
      .then((list) => {
        if (alive) {
          setFiles(list);
        }
      })
      .catch(() => undefined);

    return () => {
      alive = false;
    };
  }, [mode, rootDir]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];

    if (mode === "commands") {
      for (const command of commands) {
        if (command.needsDoc === true && !hasDoc) {
          continue;
        }

        const score = fuzzyScore(`${command.group} ${command.title}`, query);

        if (score > 0) {
          out.push({
            key: command.id,
            title: command.title,
            detail: command.group,
            keys: command.keys,
            icon: <TerminalSquare size={15} strokeWidth={1.8} />,
            score,
            run: command.run,
          });
        }
      }
    } else if (mode === "files") {
      const seen = new Set<string>();

      const add = (path: string, bonus: number) => {
        const key = pathKey(path);

        if (seen.has(key)) {
          return;
        }

        seen.add(key);
        const rel = rootDir === null ? null : relativePath(rootDir, path);
        const label = rel !== null && !rel.startsWith("..") ? rel : path;
        const score = fuzzyScore(label, query);

        if (score > 0) {
          out.push({
            key: path,
            title: basename(path),
            detail: rel !== null && !rel.startsWith("..") ? dirname(rel.replace(/\//g, "\\")) : dirname(path),
            icon: <FileText size={15} strokeWidth={1.8} />,
            score: score + bonus,
            run: () => void openFile(path),
          });
        }
      };

      recent.forEach((path) => add(path, query === "" ? 100 : 3));
      files.forEach((path) => add(path, 0));
    } else {
      outline.forEach((heading, index) => {
        const score = fuzzyScore(heading.text, query);

        if (score > 0) {
          out.push({
            key: `${heading.line}-${index}`,
            title: heading.text || "(빈 제목)",
            detail: `H${heading.level} · ${heading.line + 1}줄`,
            icon: <Hash size={15} strokeWidth={1.8} />,
            score: query === "" ? 10_000 - index : score,
            run: () => goToHeading(heading.line),
          });
        }
      });
    }

    out.sort((a, b) => b.score - a.score);

    return out.slice(0, 200);
  }, [mode, query, files, recent, outline, rootDir, hasDoc]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector(".palette-item.selected")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const choose = (item: Item | undefined) => {
    if (item === undefined) {
      return;
    }

    close();
    requestAnimationFrame(() => item.run());
  };

  return (
    <div className="overlay palette-overlay" onMouseDown={close}>
      <div className="palette" role="dialog" aria-label="명령 팔레트" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input">
          {mode === "commands" ? <ChevronRight size={16} strokeWidth={2} /> : <Search size={16} strokeWidth={2} />}
          <input
            autoFocus
            value={query}
            placeholder={PLACEHOLDER[mode]}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((value) => Math.min(items.length - 1, value + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((value) => Math.max(0, value - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(items[selected]);
              } else if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}
          />
          <span className="palette-mode">{mode === "commands" ? "명령" : mode === "files" ? "파일" : "제목"}</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {items.length === 0 ? (
            <div className="palette-empty">
              {mode === "files" && rootDir === null && recent.length === 0 ? "폴더를 열면 그 안의 문서를 찾을 수 있습니다." : "일치하는 항목이 없습니다."}
            </div>
          ) : (
            items.map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={cx("palette-item", index === selected && "selected")}
                onMouseMove={() => setSelected(index)}
                onClick={() => choose(item)}
              >
                <span className="palette-icon">{item.icon}</span>
                <span className="palette-title">{item.title}</span>
                {item.detail !== undefined ? <span className="palette-detail">{item.detail}</span> : null}
                {item.keys !== undefined ? <Kbd keys={item.keys} /> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
