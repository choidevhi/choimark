import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileText, Plus } from "lucide-react";
import { useEffect, useRef, type MouseEvent } from "react";

import { activateTab, closeOtherTabs, closeTab, copyText, newDocument, requestClose, revealInExplorer, saveTab } from "../app/actions";
import appIcon from "../assets/app-icon.png";
import { openMenu, useApp, type Tab } from "../state/store";
import { cx } from "./ui";

function TabItem({ tab, active }: { tab: Tab; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [active]);

  const onMenu = (event: MouseEvent) => {
    event.preventDefault();
    const path = tab.path;
    openMenu(event, [
      { label: "저장", keys: "Ctrl+S", run: () => void saveTab(tab.id) },
      { label: "다른 이름으로 저장…", run: () => void saveTab(tab.id, true) },
      "separator",
      { label: "닫기", keys: "Ctrl+W", run: () => void closeTab(tab.id) },
      { label: "다른 탭 모두 닫기", run: () => void closeOtherTabs(tab.id) },
      "separator",
      { label: "경로 복사", disabled: path === null, run: () => path !== null && void copyText(path, "경로를 복사했습니다.") },
      { label: "탐색기에서 보기", disabled: path === null, run: () => path !== null && void revealInExplorer(path) },
    ]);
  };

  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={active}
      className={cx("tab", active && "active", tab.dirty && "dirty", tab.conflict && "conflict")}
      title={tab.path ?? "저장하지 않은 새 문서"}
      onMouseDown={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          void closeTab(tab.id);
        } else if (event.button === 0) {
          activateTab(tab.id);
        }
      }}
      onContextMenu={onMenu}
    >
      <FileText className="tab-icon" size={14} strokeWidth={1.9} />
      <span className="tab-title">{tab.title}</span>
      <button
        type="button"
        className="tab-close"
        aria-label={`${tab.title} 닫기`}
        title="닫기 (Ctrl+W)"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          void closeTab(tab.id);
        }}
      >
        <span className="tab-dot" />
        <svg className="tab-x" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M4.5 4.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function TitleBar() {
  const tabs = useApp((s) => s.tabs);
  const activeId = useApp((s) => s.activeId);
  const maximized = useApp((s) => s.maximized);
  const sidebarOpen = useApp((s) => s.settings.sidebarOpen && !s.focusMode);
  const sidebarWidth = useApp((s) => s.settings.sidebarWidth);
  const appWindow = getCurrentWindow();

  return (
    <header className="titlebar">
      <div className="titlebar-brand" data-tauri-drag-region style={{ width: sidebarOpen ? sidebarWidth : 46 }}>
        <img src={appIcon} alt="" width={18} height={18} draggable={false} />
        {sidebarOpen ? <span className="titlebar-name">ChoiMark</span> : null}
      </div>
      <div
        className="tabstrip"
        role="tablist"
        onWheel={(event) => {
          event.currentTarget.scrollLeft += event.deltaY;
        }}
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) {
            newDocument();
          }
        }}
      >
        {tabs.map((tab) => (
          <TabItem key={tab.id} tab={tab} active={tab.id === activeId} />
        ))}
        <button type="button" className="tab-new" title="새 문서 (Ctrl+N)" aria-label="새 문서" onClick={() => newDocument()}>
          <Plus size={16} strokeWidth={1.8} />
        </button>
      </div>
      <div className="titlebar-drag" data-tauri-drag-region />
      <div className="window-controls">
        <button type="button" className="wc" aria-label="최소화" title="최소화" onClick={() => void appWindow.minimize()}>
          <span className="wc-glyph">{""}</span>
        </button>
        <button
          type="button"
          className="wc"
          aria-label={maximized ? "이전 크기로 복원" : "최대화"}
          title={maximized ? "이전 크기로 복원" : "최대화"}
          onClick={() => void appWindow.toggleMaximize()}
        >
          <span className="wc-glyph">{maximized ? "" : ""}</span>
        </button>
        <button type="button" className="wc wc-close" aria-label="닫기" title="닫기" onClick={() => void requestClose()}>
          <span className="wc-glyph">{""}</span>
        </button>
      </div>
    </header>
  );
}
