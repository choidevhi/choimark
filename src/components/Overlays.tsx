import { AlertTriangle, CheckCircle2, FileDown, Info, XCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { keepMine, reloadFromDisk } from "../app/actions";
import { useApp } from "../state/store";
import { cx } from "./ui";

export function Dialog() {
  const dialog = useApp((s) => s.dialog);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (dialog === null) {
      return;
    }

    setValue(dialog.input?.value ?? "");
    requestAnimationFrame(() => {
      const input = inputRef.current;

      if (input !== null && dialog.input !== null) {
        input.focus();
        const dot = dialog.input.selectStem ? dialog.input.value.lastIndexOf(".") : -1;
        input.setSelectionRange(0, dot > 0 ? dot : dialog.input.value.length);
      } else {
        primaryRef.current?.focus();
      }
    });
  }, [dialog]);

  if (dialog === null) {
    return null;
  }

  const cancel = dialog.buttons.find((b) => b.id === "cancel")?.id ?? dialog.buttons[0]?.id ?? "cancel";
  const primary = dialog.buttons.find((b) => b.kind === "primary")?.id ?? cancel;

  return (
    <div className="overlay dialog-overlay">
      <div
        className="dialog"
        role="alertdialog"
        aria-label={dialog.title}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            dialog.resolve({ button: cancel, value });
          } else if (event.key === "Enter" && dialog.input !== null) {
            event.preventDefault();
            dialog.resolve({ button: primary, value });
          }
        }}
      >
        <h3>{dialog.title}</h3>
        <p>{dialog.message}</p>
        {dialog.input !== null ? (
          <input
            ref={inputRef}
            className="text-input wide"
            value={value}
            placeholder={dialog.input.placeholder}
            spellCheck={false}
            onChange={(event) => setValue(event.target.value)}
          />
        ) : null}
        <div className="dialog-buttons">
          {dialog.buttons.map((button) => (
            <button
              key={button.id}
              ref={button.id === primary ? primaryRef : undefined}
              type="button"
              className={cx("button", button.kind === "primary" && "primary", button.kind === "danger" && "danger")}
              onClick={() => dialog.resolve({ button: button.id, value })}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ContextMenu() {
  const menu = useApp((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (menu === null || ref.current === null) {
      return;
    }

    const rect = ref.current.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - rect.width - 6);
    const y = menu.y + rect.height > window.innerHeight - 6 ? Math.max(6, menu.y - rect.height) : menu.y;
    setPosition({ x: Math.max(6, x), y: Math.max(6, y) });
  }, [menu]);

  useEffect(() => {
    if (menu === null) {
      return;
    }

    const close = () => useApp.setState({ menu: null });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (menu === null) {
    return null;
  }

  const close = () => useApp.setState({ menu: null });

  return (
    <div
      className="menu-layer"
      onMouseDown={close}
      onContextMenu={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div
        ref={ref}
        className="menu"
        role="menu"
        style={{ left: position.x, top: position.y }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {menu.items.map((item, index) =>
          item === "separator" ? (
            <div key={`sep-${index}`} className="menu-sep" role="separator" />
          ) : (
            <button
              key={`${item.label}-${index}`}
              type="button"
              role="menuitem"
              className={cx("menu-item", item.danger === true && "danger")}
              disabled={item.disabled}
              onClick={() => {
                close();
                item.run();
              }}
            >
              <span>{item.label}</span>
              {item.keys !== undefined ? <span className="menu-keys">{item.keys}</span> : null}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);

  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx("toast", t.kind)}>
          {t.kind === "success" ? <CheckCircle2 size={16} /> : t.kind === "error" ? <XCircle size={16} /> : <Info size={16} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export function DropOverlay() {
  const dragOver = useApp((s) => s.dragOver);

  if (!dragOver) {
    return null;
  }

  return (
    <div className="drop-overlay">
      <div className="drop-card">
        <FileDown size={30} strokeWidth={1.6} />
        <strong>여기에 놓으세요</strong>
        <span>Markdown 파일은 탭으로, 폴더는 파일 목록으로, 이미지는 문서에 링크로 들어갑니다.</span>
      </div>
    </div>
  );
}

export function ConflictBanner() {
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.activeId) ?? null);

  if (tab === null || !tab.conflict) {
    return null;
  }

  return (
    <div className="banner">
      <AlertTriangle size={16} strokeWidth={2} />
      <span>
        <strong>{tab.title}</strong> 파일이 다른 프로그램에서 바뀌었습니다. 여기에는 저장하지 않은 변경 내용이 있습니다.
      </span>
      <button type="button" className="button small" onClick={() => void reloadFromDisk(tab.id)}>
        디스크 내용 불러오기
      </button>
      <button type="button" className="button small primary" onClick={() => keepMine(tab.id)}>
        내 변경 유지
      </button>
    </div>
  );
}
