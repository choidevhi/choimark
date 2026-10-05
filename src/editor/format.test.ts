import { EditorSelection, EditorState, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import {
  formatTable,
  insertLink,
  setHeading,
  taskToggleChange,
  toggleLineKind,
  toggleTask,
  toggleWrap,
  type FormatCommand,
} from "./format";
import { displayWidth, formatTableLines } from "./table";

function apply(doc: string, from: number, to: number, command: FormatCommand) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.range(from, to),
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });

  const spec = command(state);

  if (spec === null) {
    return { doc, from, to };
  }

  const next = state.update(spec).state;

  return { doc: next.doc.toString(), from: next.selection.main.from, to: next.selection.main.to };
}

describe("toggleWrap", () => {
  it("wraps a selection and unwraps it again", () => {
    const bold = apply("안녕 세상", 3, 5, toggleWrap("**"));
    expect(bold).toEqual({ doc: "안녕 **세상**", from: 5, to: 7 });
    expect(apply(bold.doc, bold.from, bold.to, toggleWrap("**")).doc).toBe("안녕 세상");
  });

  it("wraps the word under an empty cursor", () => {
    expect(apply("hello world", 2, 2, toggleWrap("`")).doc).toBe("`hello` world");
  });

  it("keeps bold when toggling italic inside ***", () => {
    expect(apply("***x***", 3, 4, toggleWrap("*")).doc).toBe("**x**");
    expect(apply("**x**", 2, 3, toggleWrap("*")).doc).toBe("***x***");
    expect(apply("**x**", 0, 5, toggleWrap("*")).doc).toBe("***x***");
  });
});

describe("line commands", () => {
  it("sets and toggles heading levels", () => {
    expect(apply("제목", 0, 0, setHeading(2)).doc).toBe("## 제목");
    expect(apply("### 제목", 0, 0, setHeading(2)).doc).toBe("## 제목");
    expect(apply("## 제목", 0, 0, setHeading(2)).doc).toBe("제목");
  });

  it("numbers ordered lists and removes them when all lines match", () => {
    const listed = apply("가\n나\n\n다", 0, 6, toggleLineKind("ordered"));
    expect(listed.doc).toBe("1. 가\n2. 나\n\n3. 다");
    expect(apply(listed.doc, 0, listed.doc.length, toggleLineKind("ordered")).doc).toBe("가\n나\n\n다");
  });

  it("converts bullets to tasks and toggles them", () => {
    expect(apply("- 일", 0, 0, toggleLineKind("task")).doc).toBe("- [ ] 일");
    expect(apply("- [ ] 일", 0, 0, toggleTask).doc).toBe("- [x] 일");
    expect(apply("- 일", 0, 0, toggleTask).doc).toBe("- [ ] 일");
    expect(apply("일", 0, 0, toggleTask).doc).toBe("- [ ] 일");
  });

  it("quotes and unquotes", () => {
    const quoted = apply("a\nb", 0, 3, toggleLineKind("quote"));
    expect(quoted.doc).toBe("> a\n> b");
    expect(apply(quoted.doc, 0, quoted.doc.length, toggleLineKind("quote")).doc).toBe("a\nb");
  });
});

describe("links and tasks", () => {
  it("selects the URL placeholder for a new link", () => {
    const result = apply("문서", 0, 2, insertLink);
    expect(result.doc).toBe("[문서](https://)");
    expect(result.doc.slice(result.from, result.to)).toBe("https://");
  });

  it("turns a selected URL into a link", () => {
    expect(apply("https://choidev.com", 0, 19, insertLink).doc).toBe("[](https://choidev.com)");
  });

  it("flips checkboxes by source line", () => {
    const doc = Text.of(["# 할 일", "- [ ] 하나", "  1. [x] 둘", "그냥 줄"]);
    expect(taskToggleChange(doc, 1)).toEqual({ from: 9, to: 10, insert: "x" });
    expect(taskToggleChange(doc, 2)).toEqual({ from: 21, to: 22, insert: " " });
    expect(taskToggleChange(doc, 3)).toBeNull();
    expect(taskToggleChange(doc, 9)).toBeNull();
  });
});

describe("tables", () => {
  it("measures Hangul as double width", () => {
    expect(displayWidth("가a")).toBe(3);
  });

  it("aligns columns and keeps alignment markers", () => {
    const formatted = formatTableLines(["|이름|점수|", "|:-|-:|", "|홍길동|9|", "|kim|100|"]);
    expect(formatted).toEqual([
      "| 이름   | 점수 |",
      "| :----- | ---: |",
      "| 홍길동 |    9 |",
      "| kim    |  100 |",
    ]);
  });

  it("formats the table under the cursor", () => {
    const doc = "앞 문단\n\n|a|b|\n|-|-|\n|가나|c|\n\n뒤";
    expect(apply(doc, 12, 12, formatTable).doc).toBe("앞 문단\n\n| a    | b   |\n| ---- | --- |\n| 가나 | c   |\n\n뒤");
  });
});
