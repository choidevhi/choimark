import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { findNext, findPrevious, gotoLine, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type ChangeSpec, type Extension, type Text } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
  scrollPastEnd,
  type KeyBinding,
  type ViewUpdate,
} from "@codemirror/view";

import type { Settings } from "../lib/settings";
import {
  formatTable,
  insertCodeBlock,
  insertLink,
  insertTable,
  setHeading,
  toggleLineKind,
  toggleTask,
  toggleWrap,
  type FormatCommand,
} from "./format";
import { blockLines, frontMatter } from "./syntax";
import { editorTheme, markdownHighlight } from "./theme";

export type EditorEvent =
  | { type: "change"; tabId: string; dirty: boolean }
  | { type: "selection"; tabId: string }
  | { type: "scroll" }
  | { type: "blur" }
  | { type: "focus" };

type Listener = (event: EditorEvent) => void;

export interface EditorHooks {
  pasteImage: (file: File) => void;
  pasteUrlOnSelection: (url: string) => boolean;
}

const KOREAN_PHRASES = EditorState.phrases.of({
  Find: "찾기",
  Replace: "바꾸기",
  next: "다음",
  previous: "이전",
  all: "모두 선택",
  "match case": "대소문자",
  regexp: "정규식",
  "by word": "단어 단위",
  replace: "바꾸기",
  "replace all": "모두 바꾸기",
  close: "닫기",
  "current match": "현재 항목",
  "replaced $ matches": "$개를 바꿨습니다",
  "replaced match on line $": "$번째 줄을 바꿨습니다",
  "on line": "줄",
  "Go to line": "줄로 이동",
  go: "이동",
  "Folded lines": "접은 줄",
  "Unfolded lines": "펼친 줄",
  to: "~",
  "folded code": "접은 코드",
  unfold: "펼치기",
  "Fold line": "줄 접기",
  "Unfold line": "줄 펼치기",
  "Control character": "제어 문자",
});

function run(command: FormatCommand) {
  return (view: EditorView): boolean => {
    const spec = command(view.state);

    if (spec === null) {
      return false;
    }

    view.dispatch(spec);

    return true;
  };
}

function openReplace(view: EditorView): boolean {
  openSearchPanel(view);
  requestAnimationFrame(() => {
    const field = view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]");
    field?.focus();
    field?.select();
  });

  return true;
}

const formattingKeys: KeyBinding[] = [
  { key: "Mod-b", run: run(toggleWrap("**")), preventDefault: true },
  { key: "Mod-i", run: run(toggleWrap("*")), preventDefault: true },
  { key: "Mod-Shift-x", run: run(toggleWrap("~~")), preventDefault: true },
  { key: "Mod-`", run: run(toggleWrap("`")), preventDefault: true },
  { key: "Mod-Shift-h", run: run(toggleWrap("==")), preventDefault: true },
  { key: "Mod-k", run: run(insertLink), preventDefault: true },
  { key: "Mod-t", run: run(insertTable), preventDefault: true },
  { key: "Mod-Shift-c", run: run(insertCodeBlock), preventDefault: true },
  { key: "Mod-Shift-q", run: run(toggleLineKind("quote")), preventDefault: true },
  { key: "Mod-Shift-7", run: run(toggleLineKind("ordered")), preventDefault: true },
  { key: "Mod-Shift-8", run: run(toggleLineKind("bullet")), preventDefault: true },
  { key: "Mod-Shift-9", run: run(toggleLineKind("task")), preventDefault: true },
  { key: "Mod-Enter", run: run(toggleTask), preventDefault: true },
  { key: "Alt-Shift-f", run: run(formatTable), preventDefault: true },
  { key: "Mod-0", run: run(setHeading(0)), preventDefault: true },
  { key: "Mod-1", run: run(setHeading(1)), preventDefault: true },
  { key: "Mod-2", run: run(setHeading(2)), preventDefault: true },
  { key: "Mod-3", run: run(setHeading(3)), preventDefault: true },
  { key: "Mod-4", run: run(setHeading(4)), preventDefault: true },
  { key: "Mod-5", run: run(setHeading(5)), preventDefault: true },
  { key: "Mod-6", run: run(setHeading(6)), preventDefault: true },
  { key: "Mod-g", run: gotoLine, preventDefault: true },
  { key: "Mod-h", run: openReplace, preventDefault: true },
  { key: "F3", run: findNext, shift: findPrevious, preventDefault: true },
];

export class EditorController {
  view: EditorView | null = null;
  hooks: EditorHooks | null = null;
  private states = new Map<string, EditorState>();
  private saved = new Map<string, Text>();
  private scrollTops = new Map<string, number>();
  private activeId: string | null = null;
  private listeners = new Set<Listener>();
  private settings: Settings | null = null;
  private dark = false;
  private readonly gutters = new Compartment();
  private readonly wrap = new Compartment();
  private readonly activeLine = new Compartment();
  private readonly tabs = new Compartment();
  private readonly spell = new Compartment();
  private readonly themeFlag = new Compartment();

  on(listener: Listener): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  private emit(event: EditorEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private settingParts(settings: Settings | null) {
    const tabSize = settings?.tabSize ?? 2;

    return {
      gutters: settings?.lineNumbers ?? true ? [lineNumbers(), foldGutter({ markerDOM: foldMarker }), highlightActiveLineGutter()] : [],
      wrap: settings?.wordWrap ?? true ? EditorView.lineWrapping : [],
      activeLine: settings?.highlightActiveLine ?? true ? highlightActiveLine() : [],
      tabs: [EditorState.tabSize.of(tabSize), indentUnit.of(" ".repeat(tabSize))],
      spell: EditorView.contentAttributes.of({
        spellcheck: settings?.spellcheck === true ? "true" : "false",
        autocorrect: "off",
        autocapitalize: "off",
      }),
      theme: EditorView.theme({}, { dark: this.dark }),
    };
  }

  private extensions(): Extension[] {
    const parts = this.settingParts(this.settings);

    return [
      KOREAN_PHRASES,
      this.gutters.of(parts.gutters),
      this.wrap.of(parts.wrap),
      this.activeLine.of(parts.activeLine),
      this.tabs.of(parts.tabs),
      this.spell.of(parts.spell),
      this.themeFlag.of(parts.theme),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightSelectionMatches(),
      scrollPastEnd(),
      search({ top: true }),
      placeholder("여기에 마크다운을 입력하세요…"),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        addKeymap: true,
        extensions: [frontMatter],
      }),
      syntaxHighlighting(markdownHighlight),
      blockLines,
      editorTheme,
      keymap.of([...formattingKeys, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
      EditorView.updateListener.of((update) => this.handleUpdate(update)),
      EditorView.domEventHandlers({
        paste: (event, view) => this.handlePaste(event, view),
        blur: () => {
          this.emit({ type: "blur" });

          return false;
        },
        focus: () => {
          this.emit({ type: "focus" });

          return false;
        },
      }),
    ];
  }

  private handleUpdate(update: ViewUpdate): void {
    const id = this.activeId;

    if (id === null) {
      return;
    }

    if (update.docChanged) {
      const saved = this.saved.get(id);
      this.emit({ type: "change", tabId: id, dirty: saved === undefined || !update.state.doc.eq(saved) });
    }

    if (update.selectionSet || update.docChanged) {
      this.emit({ type: "selection", tabId: id });
    }
  }

  private handlePaste(event: ClipboardEvent, view: EditorView): boolean {
    const data = event.clipboardData;

    if (data === null || this.hooks === null) {
      return false;
    }

    for (const item of Array.from(data.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();

        if (file !== null) {
          event.preventDefault();
          this.hooks.pasteImage(file);

          return true;
        }
      }
    }

    const text = data.getData("text/plain");
    const range = view.state.selection.main;

    if (!range.empty && /^https?:\/\/\S+$/.test(text.trim()) && this.hooks.pasteUrlOnSelection(text.trim())) {
      event.preventDefault();

      return true;
    }

    return false;
  }

  mount(parent: HTMLElement): void {
    if (this.view !== null) {
      parent.appendChild(this.view.dom);

      return;
    }

    const state = this.activeId === null ? undefined : this.states.get(this.activeId);
    this.view = new EditorView({
      parent,
      state: state ?? EditorState.create({ doc: "", extensions: this.extensions() }),
    });

    this.view.scrollDOM.addEventListener("scroll", () => this.emit({ type: "scroll" }), { passive: true });
  }

  open(tabId: string, text: string): void {
    const state = EditorState.create({ doc: text, extensions: this.extensions() });
    this.states.set(tabId, state);
    this.saved.set(tabId, state.doc);
  }

  has(tabId: string): boolean {
    return this.states.has(tabId);
  }

  activate(tabId: string | null): void {
    const view = this.view;
    const previous = this.activeId;

    if (previous === tabId) {
      return;
    }

    if (view !== null && previous !== null && this.states.has(previous)) {
      this.states.set(previous, view.state);
      this.scrollTops.set(previous, view.scrollDOM.scrollTop);
    }

    this.activeId = tabId;

    if (view === null || tabId === null) {
      return;
    }

    const next = this.states.get(tabId);

    if (next === undefined) {
      return;
    }

    view.setState(next);
    this.reconfigure();
    const top = this.scrollTops.get(tabId) ?? 0;
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = top;
    });

    this.emit({ type: "selection", tabId });
  }

  close(tabId: string): void {
    this.states.delete(tabId);
    this.saved.delete(tabId);
    this.scrollTops.delete(tabId);

    if (this.activeId === tabId) {
      this.activeId = null;
    }
  }

  doc(tabId: string): Text | null {
    if (tabId === this.activeId && this.view !== null) {
      return this.view.state.doc;
    }

    return this.states.get(tabId)?.doc ?? null;
  }

  text(tabId: string): string {
    return this.doc(tabId)?.toString() ?? "";
  }

  savedText(tabId: string): string | null {
    return this.saved.get(tabId)?.toString() ?? null;
  }

  isDirty(tabId: string): boolean {
    const doc = this.doc(tabId);
    const saved = this.saved.get(tabId);

    return doc !== null && (saved === undefined || !doc.eq(saved));
  }

  markSaved(tabId: string, savedText?: Text): void {
    const doc = savedText ?? this.doc(tabId);

    if (doc !== null) {
      this.saved.set(tabId, doc);
    }
  }

  /** Replaces a document after an outside change, keeping the cursor nearby. */
  replaceContent(tabId: string, text: string): void {
    if (tabId === this.activeId && this.view !== null) {
      const view = this.view;
      const head = Math.min(view.state.selection.main.head, text.length);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: EditorSelection.cursor(head),
        userEvent: "reload",
      });

      this.saved.set(tabId, view.state.doc);
      this.emit({ type: "change", tabId, dirty: false });

      return;
    }

    const state = EditorState.create({ doc: text, extensions: this.extensions() });
    this.states.set(tabId, state);
    this.saved.set(tabId, state.doc);
  }

  applySettings(settings: Settings, dark: boolean): void {
    this.settings = settings;
    this.dark = dark;
    this.reconfigure();
  }

  private reconfigure(): void {
    const view = this.view;

    if (view === null) {
      return;
    }

    const parts = this.settingParts(this.settings);
    view.dispatch({
      effects: [
        this.gutters.reconfigure(parts.gutters),
        this.wrap.reconfigure(parts.wrap),
        this.activeLine.reconfigure(parts.activeLine),
        this.tabs.reconfigure(parts.tabs),
        this.spell.reconfigure(parts.spell),
        this.themeFlag.reconfigure(parts.theme),
      ],
    });
  }

  focus(): void {
    this.view?.focus();
  }

  hasFocus(): boolean {
    return this.view?.hasFocus ?? false;
  }

  run(command: FormatCommand): boolean {
    const view = this.view;

    if (view === null || this.activeId === null) {
      return false;
    }

    const handled = run(command)(view);
    view.focus();

    return handled;
  }

  runView(command: (view: EditorView) => boolean): boolean {
    const view = this.view;

    if (view === null || this.activeId === null) {
      return false;
    }

    view.focus();

    return command(view);
  }

  change(spec: ChangeSpec, userEvent = "input"): void {
    this.view?.dispatch({ changes: spec, userEvent });
  }

  insertText(text: string): void {
    const view = this.view;

    if (view === null) {
      return;
    }

    view.dispatch(view.state.replaceSelection(text));
    view.focus();
  }

  selectionText(): string {
    const view = this.view;

    if (view === null) {
      return "";
    }

    const range = view.state.selection.main;

    return view.state.sliceDoc(range.from, range.to);
  }

  cursor(): { line: number; column: number; selected: number } {
    const view = this.view;

    if (view === null) {
      return { line: 1, column: 1, selected: 0 };
    }

    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    let selected = 0;

    for (const range of view.state.selection.ranges) {
      selected += range.to - range.from;
    }

    return { line: line.number, column: head - line.from + 1, selected };
  }

  /** Moves the cursor to a 0-based line and scrolls it near the top. */
  goToLine(line: number, column = 0): void {
    const view = this.view;

    if (view === null) {
      return;
    }

    const target = view.state.doc.line(Math.min(Math.max(1, line + 1), view.state.doc.lines));
    const pos = Math.min(target.from + column, target.to);
    view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 60 }),
    });

    view.focus();
  }

  /** Fractional 0-based line at the top edge of the editor viewport. */
  topLine(): number {
    const view = this.view;

    if (view === null) {
      return 0;
    }

    const scrollerTop = view.scrollDOM.getBoundingClientRect().top;
    const height = Math.max(0, scrollerTop - view.documentTop);
    const block = view.lineBlockAtHeight(height);
    const line = view.state.doc.lineAt(block.from).number - 1;
    const fraction = block.height > 0 ? (height - block.top) / block.height : 0;

    return line + Math.min(1, Math.max(0, fraction));
  }

  scrollToLine(position: number): void {
    const view = this.view;

    if (view === null) {
      return;
    }

    const doc = view.state.doc;
    const index = Math.min(Math.max(0, Math.floor(position)), doc.lines - 1);
    const block = view.lineBlockAt(doc.line(index + 1).from);
    const target = block.top + (position - index) * block.height;
    const offset = view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop;
    view.scrollDOM.scrollTop = target + offset;
  }

  scrollToEnd(): boolean {
    const view = this.view;

    if (view === null) {
      return false;
    }

    return view.scrollDOM.scrollTop + view.scrollDOM.clientHeight >= view.scrollDOM.scrollHeight - 4;
  }

  requestMeasure(): void {
    this.view?.requestMeasure();
  }
}

function foldMarker(open: boolean): HTMLElement {
  const marker = document.createElement("span");
  marker.className = open ? "cm-fold-marker open" : "cm-fold-marker";
  marker.textContent = open ? "⌄" : "›";

  return marker;
}

export const editor = new EditorController();
