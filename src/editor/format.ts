import { EditorSelection, type ChangeSpec, type EditorState, type Line, type Text, type TransactionSpec } from "@codemirror/state";

import { findTableBlock, formatTableLines } from "./table";

export type FormatCommand = (state: EditorState) => TransactionSpec | null;

function selectedLines(state: EditorState): Line[] {
  const seen = new Set<number>();
  const lines: Line[] = [];

  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    let last = state.doc.lineAt(range.to).number;

    // A selection ending at column 0 does not really include that line.
    if (last > first && state.doc.lineAt(range.to).from === range.to) {
      last -= 1;
    }

    for (let n = first; n <= last; n += 1) {
      if (!seen.has(n)) {
        seen.add(n);
        lines.push(state.doc.line(n));
      }
    }
  }

  return lines;
}

function countRun(text: string, char: string, fromEnd: boolean): number {
  let count = 0;
  let index = fromEnd ? text.length - 1 : 0;

  while (index >= 0 && index < text.length && text[index] === char) {
    count += 1;
    index += fromEnd ? -1 : 1;
  }

  return count;
}

/** `*` and `**` share a character, so `***x***` must count as both. */
function wrappedBy(before: string, after: string, marker: string): boolean {
  if (marker === "*" || marker === "**") {
    const left = countRun(before, "*", true);
    const right = countRun(after, "*", false);

    return marker === "*" ? left % 2 === 1 && right % 2 === 1 : left >= 2 && right >= 2;
  }

  return before.endsWith(marker) && after.startsWith(marker);
}

function innerWrapped(text: string, marker: string): boolean {
  if (text.length <= marker.length * 2) {
    return false;
  }

  if (marker === "*" || marker === "**") {
    const left = countRun(text, "*", false);
    const right = countRun(text, "*", true);

    return marker === "*" ? left % 2 === 1 && right % 2 === 1 : left >= 2 && right >= 2;
  }

  return text.startsWith(marker) && text.endsWith(marker);
}

export function toggleWrap(marker: string): FormatCommand {
  return (state) => {
    const size = marker.length;

    return state.changeByRange((range) => {
      const before = state.sliceDoc(Math.max(0, range.from - 3), range.from);
      const after = state.sliceDoc(range.to, range.to + 3);

      if (wrappedBy(before, after, marker)) {
        return {
          changes: [
            { from: range.from - size, to: range.from, insert: "" },
            { from: range.to, to: range.to + size, insert: "" },
          ],
          range: EditorSelection.range(range.from - size, range.to - size),
        };
      }

      const text = state.sliceDoc(range.from, range.to);

      if (innerWrapped(text, marker)) {
        return {
          changes: { from: range.from, to: range.to, insert: text.slice(size, -size) },
          range: EditorSelection.range(range.from, range.to - size * 2),
        };
      }

      if (range.empty) {
        const word = state.wordAt(range.head);

        if (word !== null) {
          return {
            changes: [
              { from: word.from, insert: marker },
              { from: word.to, insert: marker },
            ],
            range: EditorSelection.cursor(range.head + size),
          };
        }
      }

      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + size, range.to + size),
      };
    });
  };
}

const HEADING = /^(#{1,6})[ \t]+/;

export function setHeading(level: number): FormatCommand {
  return (state) => {
    const lines = selectedLines(state);
    const allSame = lines.every((line) => (HEADING.exec(line.text)?.[1]?.length ?? 0) === level);
    const changes: ChangeSpec[] = [];

    for (const line of lines) {
      const match = HEADING.exec(line.text);
      const prefix = level === 0 || allSame ? "" : `${"#".repeat(level)} `;
      changes.push({ from: line.from, to: line.from + (match?.[0].length ?? 0), insert: prefix });
    }

    return { changes, scrollIntoView: true, userEvent: "input.format" };
  };
}

export type LineKind = "bullet" | "ordered" | "task" | "quote";

const LIST_PREFIX = /^(\s*)([-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?/;
const QUOTE_PREFIX = /^(\s*)>[ \t]?/;

function lineHasKind(text: string, kind: LineKind): boolean {
  if (kind === "quote") {
    return QUOTE_PREFIX.test(text);
  }

  const match = LIST_PREFIX.exec(text);

  if (match === null) {
    return false;
  }

  const ordered = /\d/.test(match[2] ?? "");

  if (kind === "task") {
    return match[3] !== undefined;
  }

  if (kind === "ordered") {
    return ordered && match[3] === undefined;
  }

  return !ordered && match[3] === undefined;
}

export function toggleLineKind(kind: LineKind): FormatCommand {
  return (state) => {
    const lines = selectedLines(state);
    const content = lines.filter((line) => line.text.trim() !== "");
    const targets = content.length > 0 ? content : lines;
    const remove = targets.every((line) => lineHasKind(line.text, kind));
    const changes: ChangeSpec[] = [];
    let counter = 0;

    for (const line of targets) {
      if (kind === "quote") {
        const quote = QUOTE_PREFIX.exec(line.text);

        if (remove && quote !== null) {
          changes.push({ from: line.from + (quote[1]?.length ?? 0), to: line.from + quote[0].length, insert: "" });
        } else if (!remove) {
          changes.push({ from: line.from, insert: "> " });
        }

        continue;
      }

      const match = LIST_PREFIX.exec(line.text);
      const indent = match?.[1] ?? /^\s*/.exec(line.text)?.[0] ?? "";
      const existing = match?.[0].length ?? indent.length;

      if (remove) {
        changes.push({ from: line.from + indent.length, to: line.from + existing, insert: "" });
        continue;
      }

      counter += 1;
      const prefix = kind === "ordered" ? `${counter}. ` : kind === "task" ? "- [ ] " : "- ";
      changes.push({ from: line.from + indent.length, to: line.from + existing, insert: prefix });
    }

    return { changes, scrollIntoView: true, userEvent: "input.format" };
  };
}

const TASK_BOX = /^(\s*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\])/;

/** Flips `[ ]` / `[x]` on a 0-based line. Used by preview checkbox clicks. */
export function taskToggleChange(doc: Text, lineIndex: number): ChangeSpec | null {
  if (lineIndex < 0 || lineIndex >= doc.lines) {
    return null;
  }

  const line = doc.line(lineIndex + 1);
  const match = TASK_BOX.exec(line.text);

  if (match === null) {
    return null;
  }

  const at = line.from + (match[1]?.length ?? 0);

  return { from: at, to: at + 1, insert: match[2] === " " ? "x" : " " };
}

/** Ctrl+Enter: check/uncheck tasks, or turn plain lines into tasks. */
export const toggleTask: FormatCommand = (state) => {
  const changes: ChangeSpec[] = [];

  for (const line of selectedLines(state)) {
    const flip = taskToggleChange(state.doc, line.number - 1);

    if (flip !== null) {
      changes.push(flip);
      continue;
    }

    const list = LIST_PREFIX.exec(line.text);

    if (list !== null) {
      changes.push({ from: line.from + list[0].length, insert: "[ ] " });
    } else {
      const indent = /^\s*/.exec(line.text)?.[0].length ?? 0;
      changes.push({ from: line.from + indent, insert: "- [ ] " });
    }
  }

  return { changes, userEvent: "input.format" };
};

function looksLikeUrl(text: string): boolean {
  return /^(https?:\/\/|mailto:|www\.)\S+$/i.test(text.trim());
}

export const insertLink: FormatCommand = (state) => {
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);

    if (looksLikeUrl(text)) {
      const insert = `[](${text.trim()})`;

      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + 1) };
    }

    const insert = `[${text}](https://)`;
    const urlStart = range.from + text.length + 3;

    return {
      changes: { from: range.from, to: range.to, insert },
      range: text === "" ? EditorSelection.cursor(range.from + 1) : EditorSelection.range(urlStart, urlStart + 8),
    };
  });
};

export function insertImageLink(path: string, alt: string): FormatCommand {
  return (state) =>
    state.changeByRange((range) => {
      const label = state.sliceDoc(range.from, range.to) || alt;
      const insert = `![${label}](${path})`;

      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length) };
    });
}

/** Inserts text on its own line(s), placing the cursor at `cursorOffset` within it. */
export function insertBlock(block: string, cursorOffset: number, selectLength = 0): FormatCommand {
  return (state) => {
    const range = state.selection.main;
    const line = state.doc.lineAt(range.head);
    const needsBreakBefore = line.text.trim() !== "";
    const at = needsBreakBefore ? line.to : line.from;
    const prefix = needsBreakBefore ? "\n\n" : "";
    const next = line.number < state.doc.lines ? state.doc.line(line.number + 1).text : "";
    const suffix = next.trim() === "" ? "\n" : "\n\n";
    const insert = prefix + block + suffix;
    const anchor = at + prefix.length + cursorOffset;

    return {
      changes: { from: at, to: needsBreakBefore ? at : line.to, insert },
      selection: EditorSelection.range(anchor, anchor + selectLength),
      scrollIntoView: true,
      userEvent: "input.format",
    };
  };
}

export const insertTable: FormatCommand = (state) => {
  const block = ["| 제목 1 | 제목 2 | 제목 3 |", "| ------ | ------ | ------ |", "|        |        |        |", "|        |        |        |"].join("\n");

  return insertBlock(block, 2, 4)(state);
};

export const insertCodeBlock: FormatCommand = (state) => {
  const range = state.selection.main;

  if (!range.empty) {
    const from = state.doc.lineAt(range.from);
    const to = state.doc.lineAt(range.to);
    const body = state.sliceDoc(from.from, to.to);

    return {
      changes: { from: from.from, to: to.to, insert: "```\n" + body + "\n```" },
      selection: EditorSelection.cursor(from.from + 3),
      userEvent: "input.format",
    };
  }

  return insertBlock("```\n\n```", 3)(state);
};

export const insertRule: FormatCommand = (state) => insertBlock("---", 3)(state);

export const insertMathBlock: FormatCommand = (state) => insertBlock("$$\n\n$$", 3)(state);

export const insertMermaid: FormatCommand = (state) =>
  insertBlock("```mermaid\nflowchart LR\n  A[시작] --> B{확인}\n  B -->|예| C[완료]\n  B -->|아니오| A\n```", 11)(state);

export const formatTable: FormatCommand = (state) => {
  const head = state.doc.lineAt(state.selection.main.head);
  const startLine = Math.max(1, head.number - 400);
  const endLine = Math.min(state.doc.lines, head.number + 400);
  const lines: string[] = [];

  for (let n = startLine; n <= endLine; n += 1) {
    lines.push(state.doc.line(n).text);
  }

  const block = findTableBlock(lines, head.number - startLine);

  if (block === null) {
    return null;
  }

  const formatted = formatTableLines(lines.slice(block.start, block.end + 1));

  if (formatted === null) {
    return null;
  }

  const from = state.doc.line(startLine + block.start).from;
  const to = state.doc.line(startLine + block.end).to;

  return { changes: { from, to, insert: formatted.join("\n") }, userEvent: "input.format" };
};
