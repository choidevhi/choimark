import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";

const FENCE = /^---\s*$/;
const FENCE_END = /^(---|\.\.\.)\s*$/;

/**
 * YAML front matter. Without this, lezer reads `---` as a rule and the YAML
 * as a giant setext heading.
 */
export const frontMatter: MarkdownConfig = {
  defineNodes: [
    { name: "FrontMatter", block: true, style: tags.meta },
    { name: "FrontMatterMark", style: tags.processingInstruction },
  ],
  parseBlock: [
    {
      name: "FrontMatter",
      before: "HorizontalRule",
      parse(cx: BlockContext, line: Line) {
        if (cx.lineStart !== 0 || !FENCE.test(line.text)) {
          return false;
        }

        const marks = [cx.elt("FrontMatterMark", 0, 3)];
        let end = line.text.length;

        while (cx.nextLine()) {
          end = cx.lineStart + line.text.length;

          if (FENCE_END.test(line.text)) {
            marks.push(cx.elt("FrontMatterMark", cx.lineStart, cx.lineStart + 3));
            cx.nextLine();
            break;
          }
        }

        cx.addElement(cx.elt("FrontMatter", 0, end, marks));

        return true;
      },
    },
  ],
};

const BLOCK_CLASSES: Partial<Record<string, string>> = {
  FencedCode: "cm-md-code",
  CodeBlock: "cm-md-code",
  FrontMatter: "cm-md-frontmatter",
  Blockquote: "cm-md-quote",
  Table: "cm-md-table",
};

function lineDecorations(view: EditorView): DecorationSet {
  const ranges: Array<Range<Decoration>> = [];
  const seen = new Set<string>();
  const doc = view.state.doc;

  for (const visible of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        const base = BLOCK_CLASSES[node.name];

        if (base === undefined) {
          return;
        }

        const first = doc.lineAt(node.from).number;
        const last = doc.lineAt(node.to).number;

        for (let n = first; n <= last; n += 1) {
          const line = doc.line(n);

          if (line.to < visible.from || line.from > visible.to) {
            continue;
          }

          const key = `${base}:${line.from}`;

          if (seen.has(key)) {
            continue;
          }

          seen.add(key);
          let cls = base;

          if (n === first) {
            cls += ` ${base}-first`;
          }

          if (n === last) {
            cls += ` ${base}-last`;
          }

          ranges.push(Decoration.line({ class: cls }).range(line.from));
        }

        // Code and front matter have nothing worth decorating inside.
        return base === "cm-md-code" || base === "cm-md-frontmatter" ? false : undefined;
      },
    });
  }

  return Decoration.set(ranges, true);
}

export const blockLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = lineDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = lineDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
