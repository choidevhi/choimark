import {
  Bold,
  Code,
  Columns2,
  Eye,
  Heading,
  Highlighter,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  MoreHorizontal,
  PanelLeft,
  PenLine,
  Quote,
  Search,
  Sigma,
  SquareCode,
  Strikethrough,
  Table,
  Workflow,
} from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { setViewMode, toggleSidebar } from "../app/actions";
import { runCommand } from "../app/commands";
import { editor } from "../editor/controller";
import { setHeading } from "../editor/format";
import { openMenu, useApp } from "../state/store";
import { IconButton, Segmented } from "./ui";

const ICON = { size: 17, strokeWidth: 1.85 } as const;

function Tool({ label, keys, command, children }: { label: string; keys?: string; command: string; children: ReactNode }) {
  const hasDoc = useApp((s) => s.activeId !== null);

  return (
    <IconButton label={label} keys={keys} disabled={!hasDoc} onClick={() => runCommand(command)}>
      {children}
    </IconButton>
  );
}

function headingMenu(event: MouseEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  const levels = [1, 2, 3, 4, 5, 6];
  openMenu({ clientX: rect.left, clientY: rect.bottom + 4 }, [
    { label: "본문", keys: "Ctrl+0", run: () => editor.run(setHeading(0)) },
    ...levels.map((level) => ({
      label: `제목 ${level}`,
      keys: `Ctrl+${level}`,
      run: () => editor.run(setHeading(level)),
    })),
  ]);
}

function moreMenu(event: MouseEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  openMenu({ clientX: rect.right - 240, clientY: rect.bottom + 4 }, [
    { label: "HTML로 내보내기…", run: () => runCommand("file.exportHtml") },
    { label: "PDF로 저장 / 인쇄…", keys: "Ctrl+Alt+P", run: () => runCommand("file.pdf") },
    { label: "서식 있는 텍스트로 복사", keys: "Ctrl+Alt+C", run: () => runCommand("file.copyRich") },
    { label: "HTML 코드 복사", run: () => runCommand("file.copyHtml") },
    "separator",
    { label: "수식 블록 넣기", run: () => runCommand("ins.math") },
    { label: "다이어그램 넣기 (Mermaid)", run: () => runCommand("ins.mermaid") },
    { label: "구분선 넣기", run: () => runCommand("ins.rule") },
    { label: "표 정렬", keys: "Alt+Shift+F", run: () => runCommand("fmt.table") },
    "separator",
    { label: "집중 모드", keys: "F11", run: () => runCommand("view.focus") },
    { label: "명령 팔레트", keys: "Ctrl+Shift+P", run: () => runCommand("app.palette") },
    { label: "설정", keys: "Ctrl+,", run: () => runCommand("app.settings") },
  ]);
}

export function Toolbar() {
  const viewMode = useApp((s) => s.viewMode);
  const sidebarOpen = useApp((s) => s.settings.sidebarOpen);
  const hasDoc = useApp((s) => s.activeId !== null);

  return (
    <div className="toolbar" role="toolbar" aria-label="서식 도구">
      <div className="toolbar-group">
        <IconButton label="사이드바" keys="Ctrl+Shift+B" active={sidebarOpen} onClick={() => toggleSidebar()}>
          <PanelLeft {...ICON} />
        </IconButton>
      </div>
      <div className="toolbar-scroll">
        <div className="toolbar-group">
          <IconButton label="제목 수준" className="with-caret" disabled={!hasDoc} onClick={headingMenu}>
            <Heading {...ICON} />
            <svg className="caret" viewBox="0 0 10 10" width="8" height="8" aria-hidden="true">
              <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconButton>
          <Tool label="굵게" keys="Ctrl+B" command="fmt.bold">
            <Bold {...ICON} />
          </Tool>
          <Tool label="기울임" keys="Ctrl+I" command="fmt.italic">
            <Italic {...ICON} />
          </Tool>
          <Tool label="취소선" keys="Ctrl+Shift+X" command="fmt.strike">
            <Strikethrough {...ICON} />
          </Tool>
          <Tool label="형광펜" keys="Ctrl+Shift+H" command="fmt.mark">
            <Highlighter {...ICON} />
          </Tool>
          <Tool label="인라인 코드" keys="Ctrl+`" command="fmt.code">
            <Code {...ICON} />
          </Tool>
        </div>
        <span className="toolbar-sep" />
        <div className="toolbar-group">
          <Tool label="글머리 목록" keys="Ctrl+Shift+8" command="fmt.bullet">
            <List {...ICON} />
          </Tool>
          <Tool label="번호 목록" keys="Ctrl+Shift+7" command="fmt.ordered">
            <ListOrdered {...ICON} />
          </Tool>
          <Tool label="할 일 목록" keys="Ctrl+Shift+9" command="fmt.task">
            <ListChecks {...ICON} />
          </Tool>
          <Tool label="인용" keys="Ctrl+Shift+Q" command="fmt.quote">
            <Quote {...ICON} />
          </Tool>
        </div>
        <span className="toolbar-sep" />
        <div className="toolbar-group">
          <Tool label="링크" keys="Ctrl+K" command="ins.link">
            <Link {...ICON} />
          </Tool>
          <Tool label="이미지" keys="Ctrl+Shift+I" command="ins.image">
            <Image {...ICON} />
          </Tool>
          <Tool label="표" keys="Ctrl+T" command="ins.table">
            <Table {...ICON} />
          </Tool>
          <Tool label="코드 블록" keys="Ctrl+Shift+C" command="ins.codeBlock">
            <SquareCode {...ICON} />
          </Tool>
          <Tool label="수식" command="ins.math">
            <Sigma {...ICON} />
          </Tool>
          <Tool label="다이어그램" command="ins.mermaid">
            <Workflow {...ICON} />
          </Tool>
          <Tool label="구분선" command="ins.rule">
            <Minus {...ICON} />
          </Tool>
        </div>
      </div>
      <div className="toolbar-right">
        <IconButton label="찾기 / 바꾸기" keys="Ctrl+F" disabled={!hasDoc} onClick={() => runCommand("edit.find")}>
          <Search {...ICON} />
        </IconButton>
        <Segmented
          className="view-switch"
          value={viewMode}
          onChange={setViewMode}
          options={[
            { value: "edit", label: <PenLine size={15} strokeWidth={1.9} />, title: "편집기만 (Ctrl+Alt+1)" },
            { value: "split", label: <Columns2 size={15} strokeWidth={1.9} />, title: "편집기 + 미리보기 (Ctrl+Alt+2)" },
            { value: "preview", label: <Eye size={15} strokeWidth={1.9} />, title: "미리보기만 (Ctrl+Alt+3)" },
          ]}
        />
        <IconButton label="더 보기" onClick={moreMenu}>
          <MoreHorizontal {...ICON} />
        </IconButton>
      </div>
    </div>
  );
}
