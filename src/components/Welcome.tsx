import { Command, FilePlus2, FileText, FolderOpen, FileInput, Link2, X } from "lucide-react";

import { checkDefaultApp, clearRecent, makeDefaultApp, newDocument, openFile, openFileDialog, openFolderDialog } from "../app/actions";
import appIcon from "../assets/app-icon.png";
import { basename, dirname } from "../lib/paths";
import { useApp } from "../state/store";
import { Kbd } from "./ui";

export function Welcome() {
  const recent = useApp((s) => s.recent);
  const isDefault = useApp((s) => s.isDefaultApp);
  const needsConfirm = useApp((s) => s.assocNeedsConfirm);
  const version = useApp((s) => s.platform?.version ?? "");

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-hero">
          <img src={appIcon} alt="" width={64} height={64} draggable={false} />
          <div>
            <h1>ChoiMark</h1>
            <p>쓰는 대로 바로 보이는 마크다운 편집기</p>
          </div>
        </div>

        <div className="welcome-grid">
          <section>
            <h2>시작하기</h2>
            <button type="button" className="welcome-action" onClick={() => newDocument()}>
              <FilePlus2 size={18} strokeWidth={1.8} />
              <span>새 문서</span>
              <Kbd keys="Ctrl+N" />
            </button>
            <button type="button" className="welcome-action" onClick={() => void openFileDialog()}>
              <FileInput size={18} strokeWidth={1.8} />
              <span>파일 열기</span>
              <Kbd keys="Ctrl+O" />
            </button>
            <button type="button" className="welcome-action" onClick={() => void openFolderDialog()}>
              <FolderOpen size={18} strokeWidth={1.8} />
              <span>폴더 열기</span>
              <Kbd keys="Ctrl+Shift+O" />
            </button>
            <button type="button" className="welcome-action" onClick={() => useApp.setState({ palette: "commands" })}>
              <Command size={18} strokeWidth={1.8} />
              <span>모든 명령 보기</span>
              <Kbd keys="Ctrl+Shift+P" />
            </button>
            <p className="welcome-tip">Markdown 파일이나 폴더를 창에 끌어다 놓아도 열립니다.</p>
          </section>

          <section>
            <div className="welcome-section-head">
              <h2>최근 파일</h2>
              {recent.length > 0 ? (
                <button type="button" className="link-button" onClick={() => clearRecent()}>
                  <X size={12} strokeWidth={2} /> 지우기
                </button>
              ) : null}
            </div>
            {recent.length === 0 ? (
              <p className="welcome-empty">아직 연 파일이 없습니다.</p>
            ) : (
              <ul className="recent-list">
                {recent.slice(0, 8).map((path) => (
                  <li key={path}>
                    <button type="button" className="recent-item" title={path} onClick={() => void openFile(path)}>
                      <FileText size={16} strokeWidth={1.8} />
                      <span className="recent-name">{basename(path)}</span>
                      <span className="recent-dir">{dirname(path)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {isDefault === false ? (
          <div className="welcome-callout">
            <Link2 size={18} strokeWidth={1.9} />
            <div>
              <strong>Markdown 파일을 ChoiMark로 열까요?</strong>
              <span>
                {needsConfirm
                  ? "Windows 11은 처음 한 번 직접 고르게 되어 있습니다. 버튼을 누르면 설정이 열립니다. .md를 누르고 ChoiMark를 고르세요."
                  : ".md 파일을 두 번 클릭하면 바로 이 앱에서 열립니다."}
              </span>
            </div>
            <button type="button" className="button primary" onClick={() => void makeDefaultApp().then(checkDefaultApp)}>
              기본 앱으로 설정
            </button>
          </div>
        ) : null}

        <footer className="welcome-foot">
          {version === "" ? "ChoiMark" : `ChoiMark ${version}`} · choidev
        </footer>
      </div>
    </div>
  );
}
