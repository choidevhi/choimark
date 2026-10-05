import { describe, expect, it } from "vitest";

import { hashText, renderMarkdown, slugify } from "./markdown";

const render = (source: string) => renderMarkdown(source, { breaks: false });

describe("renderMarkdown", () => {
  it("tags blocks with their source line for scroll sync", () => {
    const { html } = render("# 제목\n\n본문 문단\n\n- 하나\n- 둘\n");

    expect(html).toContain('<h1 id="제목" data-line="0">');
    expect(html).toContain('<p data-line="2">');
    expect(html).toContain('<ul data-line="4">');
  });

  it("collects top-level headings with ids and lines", () => {
    const { headings } = render("# 시작 `코드`\n\n> # 인용 속 제목\n\n## 둘째 장\n\n```\n# 코드 안\n```\n");

    expect(headings).toEqual([
      { level: 1, text: "시작 코드", line: 0, id: "시작-코드" },
      { level: 2, text: "둘째 장", line: 4, id: "둘째-장" },
    ]);
  });

  it("renders task lists with the list item's line", () => {
    const { html } = render("할 일\n\n- [ ] 장보기\n- [x] 청소\n");

    expect(html).toContain('<ul class="contains-task-list" data-line="2">');
    expect(html).toContain('<input type="checkbox" class="task-checkbox" data-task-line="2">장보기');
    expect(html).toContain('<input type="checkbox" class="task-checkbox" checked data-task-line="3">청소');
  });

  it("highlights fenced code and wraps it with a copy toolbar", () => {
    const { html } = render("```ts\nconst a = 1;\n```\n");

    expect(html).toContain('<div class="code-block" data-line="0">');
    expect(html).toContain('<span class="code-lang">ts</span>');
    expect(html).toContain('<span class="hljs-keyword">const</span>');
  });

  it("leaves mermaid source for the async renderer", () => {
    const source = "graph TD\n  A-->B\n";
    const { html } = render("```mermaid\n" + source + "```\n");

    expect(html).toContain(`data-mermaid="${hashText(source)}"`);
    expect(html).toContain("A--&gt;B");
  });

  it("renders math, tables, alerts, footnotes and front matter", () => {
    const { html } = render(
      [
        "---",
        "title: 회의록",
        "tags: 업무",
        "---",
        "",
        "인라인 $a^2$ 수식",
        "",
        "$$",
        "E = mc^2",
        "$$",
        "",
        "| 이름 | 값 |",
        "| --- | --: |",
        "| 가 | 1 |",
        "",
        "> [!WARNING]",
        "> 조심하세요",
        "",
        "각주[^1] ==강조== H~2~O x^2^ :smile:",
        "",
        "[^1]: 각주 내용",
      ].join("\n"),
    );

    expect(html).toContain('<div class="front-matter" data-line="0"><table><tr><th>title</th><td>회의록</td></tr>');
    expect(html).toContain('class="katex"');
    expect(html).toContain('<div class="math-block" data-line="7">');
    expect(html).toContain('<div class="table-wrap" data-line="11"><table>');
    expect(html).toContain("markdown-alert-warning");
    expect(html).toContain("경고");
    expect(html).toContain("<mark>강조</mark>");
    expect(html).toContain("<sub>2</sub>");
    expect(html).toContain("<sup>2</sup>");
    expect(html).toContain("😄");
    expect(html).toContain('class="footnotes"');
  });

  it("honours the line-break option", () => {
    expect(renderMarkdown("a\nb", { breaks: true }).html).toContain("a<br>");
    expect(renderMarkdown("a\nb", { breaks: false }).html).not.toContain("<br>");
  });
});

describe("slugify", () => {
  it("keeps Hangul and drops punctuation like GitHub", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("한글 제목 (2편)")).toBe("한글-제목-2편");
  });
});
