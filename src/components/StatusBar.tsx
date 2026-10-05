import { AlertTriangle, Moon, Sun, Link2 } from "lucide-react";
import type { MouseEvent } from "react";

import { checkDefaultApp, makeDefaultApp, revealInExplorer, setEncoding, toggleEol, updateSettings } from "../app/actions";
import { openMenu, useApp } from "../state/store";

const ENCODINGS: Array<{ id: string; label: string }> = [
  { id: "utf-8", label: "UTF-8" },
  { id: "utf-8-bom", label: "UTF-8 (BOM)" },
  { id: "utf-16le", label: "UTF-16 LE" },
  { id: "utf-16be", label: "UTF-16 BE" },
  { id: "EUC-KR", label: "EUC-KR (CP949)" },
];

export function encodingLabel(id: string): string {
  return ENCODINGS.find((e) => e.id.toLowerCase() === id.toLowerCase())?.label ?? id.toUpperCase();
}

function encodingMenu(event: MouseEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  openMenu(
    { clientX: rect.left, clientY: rect.top - 8 - ENCODINGS.length * 32 },
    ENCODINGS.map((encoding) => ({ label: `${encoding.label}(으)로 저장`, run: () => setEncoding(encoding.id) })),
  );
}

export function StatusBar() {
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.activeId) ?? null);
  const cursor = useApp((s) => s.cursor);
  const stats = useApp((s) => s.stats);
  const isDefault = useApp((s) => s.isDefaultApp);
  const theme = useApp((s) => s.settings.theme);
  const dark = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";

  return (
    <footer className="statusbar">
      <div className="status-left">
        {tab === null ? (
          <span className="status-item muted">ChoiMark</span>
        ) : (
          <button
            type="button"
            className="status-item status-path"
            title={tab.path === null ? "아직 저장하지 않았습니다" : `${tab.path}\n클릭하면 탐색기에서 엽니다`}
            onClick={() => tab.path !== null && void revealInExplorer(tab.path)}
          >
            {tab.path ?? "저장하지 않은 새 문서"}
          </button>
        )}
        {tab?.readonly === true ? <span className="status-badge">읽기 전용</span> : null}
        {tab?.missing === true ? <span className="status-badge warn">디스크에 없음</span> : null}
      </div>
      <div className="status-right">
        {isDefault === false ? (
          <button
            type="button"
            className="status-item status-warn"
            title="Markdown 파일(.md 등)을 두 번 클릭하면 ChoiMark로 열리게 합니다"
            onClick={() => void makeDefaultApp().then(checkDefaultApp)}
          >
            <Link2 size={13} strokeWidth={2} />
            기본 앱으로 설정
          </button>
        ) : null}
        {tab !== null ? (
          <>
            <span className="status-item">
              줄 {cursor.line}, 열 {cursor.column}
              {cursor.selected > 0 ? ` (${cursor.selected.toLocaleString()} 선택)` : ""}
            </span>
            <span className="status-item" title={`공백 포함 ${stats.chars.toLocaleString()}자 · ${stats.lines.toLocaleString()}줄`}>
              {stats.charsNoSpace.toLocaleString()}자 · {stats.words.toLocaleString()}단어
            </span>
            <button type="button" className="status-item" title="저장할 인코딩 선택" onClick={encodingMenu}>
              {encodingLabel(tab.encoding)}
            </button>
            <button type="button" className="status-item" title="줄 끝 문자 바꾸기" onClick={() => toggleEol()}>
              {tab.eol === "crlf" ? "CRLF" : "LF"}
            </button>
            {tab.conflict ? (
              <span className="status-item status-warn">
                <AlertTriangle size={13} strokeWidth={2} /> 충돌
              </span>
            ) : null}
          </>
        ) : null}
        <button
          type="button"
          className="status-item status-icon"
          title={`테마: ${theme === "system" ? "시스템" : theme === "dark" ? "어두움" : "밝음"} (클릭해서 전환)`}
          onClick={() => updateSettings({ theme: dark ? "light" : "dark" })}
        >
          {dark ? <Moon size={13} strokeWidth={2} /> : <Sun size={13} strokeWidth={2} />}
        </button>
      </div>
    </footer>
  );
}
