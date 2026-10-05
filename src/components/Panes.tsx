import { useEffect, useRef, type PointerEvent } from "react";

import { updateSettings } from "../app/actions";
import { editorMenu } from "../app/bootstrap";
import { editor } from "../editor/controller";
import { preview } from "../preview/preview";
import { getState, useApp } from "../state/store";
import { cx } from "./ui";

function EditorPane() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (host.current !== null) {
      editor.mount(host.current);
    }
  }, []);

  return <div className="editor-host" ref={host} onContextMenu={(event) => editorMenu(event.nativeEvent)} />;
}

function PreviewPane() {
  const scroller = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLElement>(null);

  useEffect(() => {
    if (scroller.current === null || article.current === null) {
      return;
    }

    const unmount = preview.mount(scroller.current, article.current);
    preview.invalidate();

    return unmount;
  }, []);

  return (
    <div className="preview-scroll" ref={scroller} tabIndex={-1}>
      <article className="markdown-body" ref={article} />
    </div>
  );
}

function Splitter() {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const panes = target.parentElement;

    if (panes === null) {
      return;
    }

    const rect = panes.getBoundingClientRect();
    target.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-col");

    const move = (e: globalThis.PointerEvent) => {
      const ratio = Math.min(0.8, Math.max(0.2, (e.clientX - rect.left) / rect.width));
      useApp.setState((state) => ({ settings: { ...state.settings, splitRatio: ratio } }));
    };

    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing-col");
      updateSettings({ splitRatio: getState().settings.splitRatio });
      editor.requestMeasure();
    };

    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      title="끌어서 크기 조절 · 두 번 클릭하면 반반"
      onPointerDown={onPointerDown}
      onDoubleClick={() => updateSettings({ splitRatio: 0.5 })}
    >
      <span className="splitter-line" />
    </div>
  );
}

export function Panes() {
  const viewMode = useApp((s) => s.viewMode);
  const ratio = useApp((s) => s.settings.splitRatio);
  const columns = viewMode === "split" ? `${ratio}fr 0px ${1 - ratio}fr` : viewMode === "edit" ? "1fr 0px 0fr" : "0fr 0px 1fr";

  return (
    <div className={cx("panes", `mode-${viewMode}`)} style={{ gridTemplateColumns: columns }}>
      <section className="pane pane-editor" aria-label="편집기" aria-hidden={viewMode === "preview"}>
        <EditorPane />
      </section>
      {viewMode === "split" ? <Splitter /> : <span className="splitter-placeholder" />}
      <section className="pane pane-preview" aria-label="미리보기" aria-hidden={viewMode === "edit"}>
        <PreviewPane />
      </section>
    </div>
  );
}
