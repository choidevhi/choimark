import { gotoLine, openSearchPanel } from "@codemirror/search";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { editor } from "../editor/controller";
import {
  formatTable,
  insertCodeBlock,
  insertLink,
  insertMathBlock,
  insertMermaid,
  insertRule,
  insertTable,
  setHeading,
  toggleLineKind,
  toggleTask,
  toggleWrap,
} from "../editor/format";
import { activeTab, getState, useApp } from "../state/store";
import {
  checkDefaultApp,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  copyAsRichText,
  copyHtmlSource,
  cycleTab,
  exportHtml,
  insertImageFromDialog,
  makeDefaultApp,
  newDocument,
  openFileDialog,
  openFolderDialog,
  printToPdf,
  reopenClosedTab,
  requestClose,
  revealInExplorer,
  saveActive,
  saveAll,
  setViewMode,
  toggleEol,
  toggleFocusMode,
  togglePreviewOnly,
  toggleSidebar,
  toggleSplit,
  updateSettings,
  zoom,
} from "./actions";

export interface Command {
  id: string;
  title: string;
  group: string;
  keys?: string;
  /** Runs inside the editor's own keymap, so the global handler skips it. */
  editorKey?: boolean;
  needsDoc?: boolean;
  run: () => void;
}

function withDoc(run: () => void): () => void {
  return () => {
    if (activeTab() !== null) {
      run();
    }
  };
}

export const commands: Command[] = [
  { id: "file.new", title: "새 문서", group: "파일", keys: "Ctrl+N", run: () => newDocument() },
  { id: "file.open", title: "파일 열기…", group: "파일", keys: "Ctrl+O", run: () => void openFileDialog() },
  { id: "file.openFolder", title: "폴더 열기…", group: "파일", keys: "Ctrl+Shift+O", run: () => void openFolderDialog() },
  { id: "file.quickOpen", title: "빠른 열기 (폴더 안 문서·최근 파일)", group: "파일", keys: "Ctrl+P", run: () => useApp.setState({ palette: "files" }) },
  { id: "file.save", title: "저장", group: "파일", keys: "Ctrl+S", needsDoc: true, run: withDoc(() => void saveActive()) },
  { id: "file.saveAs", title: "다른 이름으로 저장…", group: "파일", keys: "Ctrl+Shift+S", needsDoc: true, run: withDoc(() => void saveActive(true)) },
  { id: "file.saveAll", title: "모두 저장", group: "파일", keys: "Ctrl+Alt+S", run: () => void saveAll() },
  { id: "file.close", title: "탭 닫기", group: "파일", keys: "Ctrl+W", needsDoc: true, run: withDoc(() => void closeTab(getState().activeId ?? "")) },
  { id: "file.closeOthers", title: "다른 탭 모두 닫기", group: "파일", needsDoc: true, run: withDoc(() => void closeOtherTabs(getState().activeId ?? "")) },
  { id: "file.closeAll", title: "모든 탭 닫기", group: "파일", run: () => void closeAllTabs() },
  { id: "file.reopen", title: "닫은 탭 다시 열기", group: "파일", keys: "Ctrl+Shift+T", run: () => void reopenClosedTab() },
  {
    id: "file.reveal",
    title: "탐색기에서 보기",
    group: "파일",
    needsDoc: true,
    run: withDoc(() => {
      const path = activeTab()?.path;

      if (path !== null && path !== undefined) {
        void revealInExplorer(path);
      }
    }),
  },
  { id: "file.exportHtml", title: "HTML로 내보내기…", group: "내보내기", needsDoc: true, run: withDoc(() => void exportHtml()) },
  { id: "file.pdf", title: "PDF로 저장 / 인쇄…", group: "내보내기", keys: "Ctrl+Alt+P", needsDoc: true, run: withDoc(() => void printToPdf()) },
  { id: "file.copyRich", title: "서식 있는 텍스트로 복사 (블로그·메일용)", group: "내보내기", keys: "Ctrl+Alt+C", needsDoc: true, run: withDoc(() => void copyAsRichText()) },
  { id: "file.copyHtml", title: "HTML 코드 복사", group: "내보내기", needsDoc: true, run: withDoc(() => void copyHtmlSource()) },
  { id: "app.quit", title: "끝내기", group: "파일", keys: "Alt+F4", run: () => void requestClose() },

  { id: "fmt.bold", title: "굵게", group: "서식", keys: "Ctrl+B", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(toggleWrap("**"))) },
  { id: "fmt.italic", title: "기울임", group: "서식", keys: "Ctrl+I", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(toggleWrap("*"))) },
  { id: "fmt.strike", title: "취소선", group: "서식", keys: "Ctrl+Shift+X", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(toggleWrap("~~"))) },
  { id: "fmt.code", title: "인라인 코드", group: "서식", keys: "Ctrl+`", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(toggleWrap("`"))) },
  { id: "fmt.mark", title: "형광펜", group: "서식", keys: "Ctrl+Shift+H", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(toggleWrap("=="))) },
  { id: "fmt.h1", title: "제목 1", group: "서식", keys: "Ctrl+1", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(setHeading(1))) },
  { id: "fmt.h2", title: "제목 2", group: "서식", keys: "Ctrl+2", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(setHeading(2))) },
  { id: "fmt.h3", title: "제목 3", group: "서식", keys: "Ctrl+3", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(setHeading(3))) },
  { id: "fmt.h4", title: "제목 4", group: "서식", keys: "Ctrl+4", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(setHeading(4))) },
  { id: "fmt.h0", title: "본문 (제목 해제)", group: "서식", keys: "Ctrl+0", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(setHeading(0))) },
  { id: "fmt.bullet", title: "글머리 목록", group: "서식", keys: "Ctrl+Shift+8", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(toggleLineKind("bullet"))) },
  { id: "fmt.ordered", title: "번호 목록", group: "서식", keys: "Ctrl+Shift+7", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(toggleLineKind("ordered"))) },
  { id: "fmt.task", title: "할 일 목록", group: "서식", keys: "Ctrl+Shift+9", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(toggleLineKind("task"))) },
  { id: "fmt.toggleTask", title: "할 일 체크/해제", group: "서식", keys: "Ctrl+Enter", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(toggleTask)) },
  { id: "fmt.quote", title: "인용", group: "서식", keys: "Ctrl+Shift+Q", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(toggleLineKind("quote"))) },
  { id: "ins.link", title: "링크 넣기", group: "넣기", keys: "Ctrl+K", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(insertLink)) },
  { id: "ins.image", title: "이미지 넣기…", group: "넣기", keys: "Ctrl+Shift+I", needsDoc: true, run: withDoc(() => void insertImageFromDialog()) },
  { id: "ins.table", title: "표 넣기", group: "넣기", keys: "Ctrl+T", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(insertTable)) },
  { id: "ins.codeBlock", title: "코드 블록", group: "넣기", keys: "Ctrl+Shift+C", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(insertCodeBlock)) },
  { id: "ins.math", title: "수식 블록", group: "넣기", needsDoc: true, run: withDoc(() => editor.run(insertMathBlock)) },
  { id: "ins.mermaid", title: "다이어그램 (Mermaid)", group: "넣기", needsDoc: true, run: withDoc(() => editor.run(insertMermaid)) },
  { id: "ins.rule", title: "구분선", group: "넣기", needsDoc: true, run: withDoc(() => editor.run(insertRule)) },
  { id: "fmt.table", title: "표 정렬", group: "서식", keys: "Alt+Shift+F", editorKey: true, needsDoc: true, run: withDoc(() => editor.run(formatTable)) },
  { id: "edit.find", title: "찾기 / 바꾸기", group: "편집", keys: "Ctrl+F", needsDoc: true, run: withDoc(() => openFind()) },
  { id: "edit.gotoLine", title: "줄로 이동", group: "편집", keys: "Ctrl+G", editorKey: true, needsDoc: true, run: withDoc(() => editor.runView(gotoLine)) },

  { id: "view.edit", title: "편집기만 보기", group: "보기", keys: "Ctrl+Alt+1", run: () => setViewMode("edit") },
  { id: "view.split", title: "편집기 + 미리보기", group: "보기", keys: "Ctrl+Alt+2", run: () => setViewMode("split") },
  { id: "view.preview", title: "미리보기만 보기", group: "보기", keys: "Ctrl+Alt+3", run: () => setViewMode("preview") },
  { id: "view.toggleSplit", title: "분할 보기 켜기/끄기", group: "보기", keys: "Ctrl+\\", run: () => toggleSplit() },
  { id: "view.togglePreview", title: "미리보기 전환", group: "보기", keys: "Ctrl+E", run: () => togglePreviewOnly() },
  { id: "view.sidebar", title: "사이드바 보이기/숨기기", group: "보기", keys: "Ctrl+Shift+B", run: () => toggleSidebar() },
  { id: "view.files", title: "파일 탐색기", group: "보기", keys: "Ctrl+Shift+E", run: () => toggleSidebar("files") },
  { id: "view.outline", title: "개요 (목차)", group: "보기", keys: "Ctrl+Shift+1", run: () => toggleSidebar("outline") },
  { id: "view.search", title: "폴더에서 찾기", group: "보기", keys: "Ctrl+Shift+F", run: () => toggleSidebar("search") },
  { id: "view.gotoHeading", title: "제목으로 이동…", group: "보기", keys: "Ctrl+R", needsDoc: true, run: withDoc(() => useApp.setState({ palette: "outline" })) },
  { id: "view.focus", title: "집중 모드 (전체 화면)", group: "보기", keys: "F11", run: () => toggleFocusMode() },
  { id: "view.zoomIn", title: "글자 크게", group: "보기", keys: "Ctrl+=", run: () => zoom(1) },
  { id: "view.zoomOut", title: "글자 작게", group: "보기", keys: "Ctrl+-", run: () => zoom(-1) },
  { id: "view.zoomReset", title: "글자 크기 기본값", group: "보기", run: () => zoom(0) },
  { id: "view.nextTab", title: "다음 탭", group: "보기", keys: "Ctrl+Tab", run: () => cycleTab(1) },
  { id: "view.prevTab", title: "이전 탭", group: "보기", keys: "Ctrl+Shift+Tab", run: () => cycleTab(-1) },
  {
    id: "view.theme",
    title: "밝은/어두운 테마 전환",
    group: "보기",
    run: () => {
      const dark = document.documentElement.dataset.theme === "dark";
      updateSettings({ theme: dark ? "light" : "dark" });
    },
  },
  { id: "view.wrap", title: "자동 줄바꿈 켜기/끄기", group: "보기", keys: "Alt+Z", run: () => updateSettings({ wordWrap: !getState().settings.wordWrap }) },
  { id: "view.lineNumbers", title: "줄 번호 켜기/끄기", group: "보기", run: () => updateSettings({ lineNumbers: !getState().settings.lineNumbers }) },
  { id: "view.sync", title: "스크롤 동기화 켜기/끄기", group: "보기", run: () => updateSettings({ syncScroll: !getState().settings.syncScroll }) },
  { id: "doc.eol", title: "줄 끝 바꾸기 (CRLF ↔ LF)", group: "문서", needsDoc: true, run: withDoc(() => toggleEol()) },
  { id: "app.settings", title: "설정", group: "앱", keys: "Ctrl+,", run: () => useApp.setState({ settingsOpen: true }) },
  { id: "app.palette", title: "명령 팔레트", group: "앱", keys: "Ctrl+Shift+P", run: () => useApp.setState({ palette: "commands" }) },
  {
    id: "app.defaultApp",
    title: "모든 Markdown 파일을 ChoiMark로 열기",
    group: "앱",
    run: () => {
      void makeDefaultApp().then(checkDefaultApp);
    },
  },
  {
    id: "app.minimize",
    title: "창 최소화",
    group: "앱",
    run: () => {
      void getCurrentWindow().minimize();
    },
  },
];

function openFind(): void {
  if (getState().viewMode === "preview") {
    setViewMode("split");
  }

  requestAnimationFrame(() => {
    editor.runView((view) => openSearchPanel(view));
  });
}

export function findCommand(id: string): Command | undefined {
  return commands.find((command) => command.id === id);
}

export function runCommand(id: string): void {
  findCommand(id)?.run();
}
