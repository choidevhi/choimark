import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// Colors come from CSS variables so light/dark switches without rebuilding
// the editor; only the `dark` flag (used by CodeMirror's own defaults) is
// swapped through a compartment.

export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--editor-bg)",
    color: "var(--text)",
    fontSize: "var(--editor-font-size)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--editor-font)",
    lineHeight: "1.72",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "24px 0 24px",
    caretColor: "var(--accent)",
  },
  ".cm-line": {
    padding: "0 28px 0 18px",
  },
  ".cm-gutters": {
    backgroundColor: "var(--editor-bg)",
    color: "var(--text-4)",
    border: "none",
    fontFamily: "var(--font-mono)",
    fontSize: "0.78em",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 4px 0 14px",
    minWidth: "38px",
  },
  ".cm-foldGutter .cm-gutterElement": {
    padding: "0 4px",
    color: "var(--text-4)",
    cursor: "pointer",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--editor-active-line)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--text-2)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--editor-selection) !important",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--accent)",
    borderLeftWidth: "2px",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--search-match)",
    borderRadius: "3px",
    outline: "1px solid var(--search-match-border)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--search-current)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "var(--selection-match)",
    borderRadius: "3px",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--accent-soft)",
    outline: "1px solid var(--accent-border)",
    borderRadius: "2px",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--accent-soft)",
    border: "none",
    color: "var(--accent-text)",
    padding: "0 6px",
    borderRadius: "4px",
  },
  ".cm-placeholder": {
    color: "var(--text-4)",
  },
  ".cm-panels": {
    backgroundColor: "var(--chrome)",
    color: "var(--text)",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--border)",
  },
  ".cm-panel.cm-search": {
    padding: "8px 40px 8px 14px",
    fontFamily: "var(--font-ui)",
    fontSize: "12.5px",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
  },
  ".cm-panel.cm-search br": {
    flexBasis: "100%",
    height: "0",
  },
  ".cm-panel.cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    color: "var(--text-2)",
    margin: "0 4px",
    cursor: "pointer",
  },
  ".cm-panel.cm-search [name=close]": {
    position: "absolute",
    top: "8px",
    right: "12px",
    width: "24px",
    height: "24px",
    border: "none",
    borderRadius: "6px",
    background: "transparent",
    color: "var(--text-3)",
    fontSize: "18px",
    lineHeight: "1",
    cursor: "pointer",
  },
  ".cm-panel.cm-search [name=close]:hover": {
    background: "var(--hover)",
    color: "var(--text)",
  },
  ".cm-textfield": {
    height: "28px",
    padding: "0 10px",
    border: "1px solid var(--border-strong)",
    borderRadius: "7px",
    background: "var(--input-bg)",
    color: "var(--text)",
    fontFamily: "var(--font-ui)",
    fontSize: "12.5px",
    minWidth: "200px",
    outline: "none",
  },
  ".cm-textfield:focus": {
    borderColor: "var(--accent)",
    boxShadow: "0 0 0 3px var(--accent-soft)",
  },
  ".cm-button": {
    height: "28px",
    padding: "0 10px",
    border: "1px solid var(--border-strong)",
    borderRadius: "7px",
    backgroundImage: "none",
    background: "var(--button-bg)",
    color: "var(--text)",
    fontFamily: "var(--font-ui)",
    fontSize: "12.5px",
    cursor: "pointer",
  },
  ".cm-button:hover": {
    background: "var(--hover)",
  },
  ".cm-button:active": {
    backgroundImage: "none",
    background: "var(--active)",
  },
  ".cm-tooltip": {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "var(--shadow-lg)",
    color: "var(--text)",
  },
  ".cm-md-code": {
    backgroundColor: "var(--editor-code-bg)",
  },
  ".cm-md-frontmatter": {
    backgroundColor: "var(--editor-meta-bg)",
  },
  ".cm-md-quote": {
    boxShadow: "inset 3px 0 0 var(--quote-bar)",
  },
});

export const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.55em", fontWeight: "750", color: "var(--md-heading)", letterSpacing: "-0.01em" },
  { tag: t.heading2, fontSize: "1.34em", fontWeight: "720", color: "var(--md-heading)" },
  { tag: t.heading3, fontSize: "1.18em", fontWeight: "700", color: "var(--md-heading)" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "700", color: "var(--md-heading)" },
  { tag: t.strong, fontWeight: "700", color: "var(--md-strong)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--text-3)" },
  { tag: t.link, color: "var(--md-link)" },
  { tag: t.url, color: "var(--md-url)", textDecoration: "underline", textDecorationColor: "var(--md-url-line)" },
  { tag: t.monospace, color: "var(--md-code)" },
  { tag: t.quote, color: "var(--md-quote)" },
  { tag: [t.processingInstruction, t.contentSeparator], color: "var(--md-mark)" },
  { tag: t.list, color: "var(--md-list)" },
  { tag: t.meta, color: "var(--md-meta)" },
  { tag: t.comment, color: "var(--hl-comment)", fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--hl-keyword)" },
  { tag: [t.string, t.special(t.string), t.character], color: "var(--hl-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--hl-number)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: "var(--hl-function)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--hl-type)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--hl-attr)" },
  { tag: [t.tagName, t.angleBracket], color: "var(--hl-tag)" },
  { tag: [t.regexp, t.escape], color: "var(--hl-regexp)" },
  { tag: [t.variableName, t.labelName], color: "var(--hl-variable)" },
  { tag: t.invalid, color: "var(--danger)" },
]);
