import { CheckCircle2, Link2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { checkDefaultApp, makeDefaultApp, updateSettings } from "../app/actions";
import { commands } from "../app/commands";
import { ipc, type AssocStatus } from "../lib/ipc";
import type { Settings } from "../lib/settings";
import { useApp } from "../state/store";
import { Kbd, Segmented, Switch, cx } from "./ui";

type Section = "general" | "editor" | "preview" | "files" | "keys";

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "general", label: "일반" },
  { id: "editor", label: "편집기" },
  { id: "preview", label: "미리보기" },
  { id: "files", label: "파일 · 연결" },
  { id: "keys", label: "단축키" },
];

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div className="setting-title">{title}</div>
        {hint !== undefined ? <div className="setting-hint">{hint}</div> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="stepper">
      <button type="button" aria-label="작게" disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span>{value}px</span>
      <button type="button" aria-label="크게" disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

function AssociationCard() {
  const [status, setStatus] = useState<AssocStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void ipc
      .associationStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  const apply = async () => {
    setBusy(true);
    await makeDefaultApp();
    await checkDefaultApp();
    setStatus(await ipc.associationStatus().catch(() => null));
    setBusy(false);
  };

  return (
    <div className={cx("assoc-card", status?.isDefault === true && "ok")}>
      <div className="assoc-icon">{status?.isDefault === true ? <CheckCircle2 size={20} /> : <Link2 size={20} />}</div>
      <div className="assoc-text">
        <strong>{status?.isDefault === true ? "모든 Markdown 파일이 ChoiMark로 열립니다" : "Markdown 파일 연결"}</strong>
        <span>
          {status === null
            ? "확인하는 중…"
            : status.isDefault
              ? `.${status.linked.join(", .")}`
              : status.needsConfirm
                ? `Windows 11은 처음 한 번 직접 골라야 합니다. 버튼을 누르면 설정이 열립니다. 아직 연결 안 됨: .${status.unlinked.join(", .")}`
                : `지금 .md 파일은 ${status.handlerName || status.handler || "연결된 앱 없음"}(으)로 열립니다.`}
        </span>
      </div>
      <button type="button" className={cx("button", status?.isDefault !== true && "primary")} disabled={busy} onClick={() => void apply()}>
        {status?.isDefault === true ? "다시 연결" : "ChoiMark로 열기"}
      </button>
    </div>
  );
}

export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen);
  const settings = useApp((s) => s.settings);
  const version = useApp((s) => s.platform?.version ?? "");
  const [section, setSection] = useState<Section>("general");

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        useApp.setState({ settingsOpen: false });
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) {
    return null;
  }

  const close = () => useApp.setState({ settingsOpen: false });
  const set = (patch: Partial<Settings>) => updateSettings(patch);

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="settings" role="dialog" aria-label="설정" onMouseDown={(event) => event.stopPropagation()}>
        <nav className="settings-nav">
          <div className="settings-heading">설정</div>
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx("settings-nav-item", section === item.id && "selected")}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
          <div className="settings-version">{version === "" ? "" : `ChoiMark ${version}`}</div>
        </nav>
        <div className="settings-body">
          <button type="button" className="dialog-close" aria-label="닫기" onClick={close} autoFocus>
            <X size={16} strokeWidth={2} />
          </button>

          {section === "general" ? (
            <>
              <h2>일반</h2>
              <Row title="테마">
                <Segmented
                  value={settings.theme}
                  onChange={(theme) => set({ theme })}
                  options={[
                    { value: "system", label: "시스템" },
                    { value: "light", label: "밝게" },
                    { value: "dark", label: "어둡게" },
                  ]}
                />
              </Row>
              <Row title="처음 보기 방식" hint="새 창과 새 문서를 어떤 화면으로 열지 정합니다.">
                <Segmented
                  value={settings.defaultViewMode}
                  onChange={(defaultViewMode) => set({ defaultViewMode })}
                  options={[
                    { value: "edit", label: "편집" },
                    { value: "split", label: "분할" },
                    { value: "preview", label: "미리보기" },
                  ]}
                />
              </Row>
              <Row title="시작할 때 열려 있던 탭 복원">
                <Switch label="탭 복원" checked={settings.restoreSession} onChange={(restoreSession) => set({ restoreSession })} />
              </Row>
              <Row title="자동 저장" hint="저장한 적 있는 파일만 자동으로 저장합니다.">
                <Segmented
                  value={settings.autoSave}
                  onChange={(autoSave) => set({ autoSave })}
                  options={[
                    { value: "off", label: "끔" },
                    { value: "delay", label: "입력 멈추면" },
                    { value: "blur", label: "편집기 벗어나면" },
                  ]}
                />
              </Row>
            </>
          ) : null}

          {section === "editor" ? (
            <>
              <h2>편집기</h2>
              <Row title="글꼴" hint="D2Coding은 한글이 영문 두 칸이라 표가 반듯하게 맞습니다.">
                <Segmented
                  value={settings.editorFont}
                  onChange={(editorFont) => set({ editorFont })}
                  options={[
                    { value: "d2coding", label: "D2Coding" },
                    { value: "jetbrains", label: "JetBrains Mono" },
                    { value: "sans", label: "본문체" },
                  ]}
                />
              </Row>
              <Row title="글자 크기">
                <Stepper value={settings.editorFontSize} min={10} max={32} onChange={(editorFontSize) => set({ editorFontSize })} />
              </Row>
              <Row title="줄 번호">
                <Switch label="줄 번호" checked={settings.lineNumbers} onChange={(lineNumbers) => set({ lineNumbers })} />
              </Row>
              <Row title="자동 줄바꿈" hint="Alt+Z">
                <Switch label="자동 줄바꿈" checked={settings.wordWrap} onChange={(wordWrap) => set({ wordWrap })} />
              </Row>
              <Row title="현재 줄 강조">
                <Switch
                  label="현재 줄 강조"
                  checked={settings.highlightActiveLine}
                  onChange={(highlightActiveLine) => set({ highlightActiveLine })}
                />
              </Row>
              <Row title="탭 크기">
                <Segmented
                  value={String(settings.tabSize)}
                  onChange={(value) => set({ tabSize: Number(value) })}
                  options={[
                    { value: "2", label: "2칸" },
                    { value: "4", label: "4칸" },
                  ]}
                />
              </Row>
              <Row title="맞춤법 검사" hint="Windows 맞춤법 검사기를 씁니다.">
                <Switch label="맞춤법 검사" checked={settings.spellcheck} onChange={(spellcheck) => set({ spellcheck })} />
              </Row>
            </>
          ) : null}

          {section === "preview" ? (
            <>
              <h2>미리보기</h2>
              <Row title="글자 크기">
                <Stepper value={settings.previewFontSize} min={11} max={32} onChange={(previewFontSize) => set({ previewFontSize })} />
              </Row>
              <Row title="본문 폭">
                <Segmented
                  value={settings.previewWidth}
                  onChange={(previewWidth) => set({ previewWidth })}
                  options={[
                    { value: "narrow", label: "좁게" },
                    { value: "normal", label: "보통" },
                    { value: "wide", label: "넓게" },
                    { value: "full", label: "가득" },
                  ]}
                />
              </Row>
              <Row title="스크롤 동기화" hint="분할 화면에서 편집기와 미리보기를 함께 움직입니다.">
                <Switch label="스크롤 동기화" checked={settings.syncScroll} onChange={(syncScroll) => set({ syncScroll })} />
              </Row>
              <Row title="줄바꿈 그대로 보이기" hint="끄면 GitHub처럼 빈 줄로 문단을 나눕니다.">
                <Switch label="줄바꿈 그대로" checked={settings.previewBreaks} onChange={(previewBreaks) => set({ previewBreaks })} />
              </Row>
            </>
          ) : null}

          {section === "files" ? (
            <>
              <h2>파일 · 연결</h2>
              <AssociationCard />
              <Row title="붙여 넣은 이미지 저장 폴더" hint="문서 옆에 이 이름의 폴더를 만들어 저장합니다.">
                <input
                  className="text-input"
                  value={settings.imageFolder}
                  spellCheck={false}
                  onChange={(event) => set({ imageFolder: event.target.value })}
                  onBlur={(event) => {
                    if (event.target.value.trim() === "") {
                      set({ imageFolder: "assets" });
                    }
                  }}
                />
              </Row>
              <Row title="파일 목록에 보일 파일">
                <Segmented
                  value={settings.fileFilter}
                  onChange={(fileFilter) => set({ fileFilter })}
                  options={[
                    { value: "markdown", label: "Markdown만" },
                    { value: "all", label: "모든 파일" },
                  ]}
                />
              </Row>
            </>
          ) : null}

          {section === "keys" ? (
            <>
              <h2>단축키</h2>
              <div className="keys-table">
                {commands.map((command) =>
                  command.keys === undefined ? null : (
                    <div key={command.id} className="keys-row">
                      <span className="keys-group">{command.group}</span>
                      <span className="keys-title">{command.title}</span>
                      <Kbd keys={command.keys} />
                    </div>
                  ),
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
