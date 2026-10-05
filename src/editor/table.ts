// Markdown table alignment. Widths count East Asian wide characters as two
// columns so Hangul tables line up in a 2:1 monospace font such as D2Coding.

export type Align = "left" | "center" | "right" | "none";

const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

function isWide(code: number): boolean {
  return WIDE_RANGES.some(([start, end]) => code >= start && code <= end);
}

function isZeroWidth(code: number): boolean {
  return (code >= 0x0300 && code <= 0x036f) || code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f);
}

export function displayWidth(text: string): number {
  let width = 0;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;

    if (isZeroWidth(code)) {
      continue;
    }

    width += isWide(code) ? 2 : 1;
  }

  return width;
}

/** Splits a table row on unescaped pipes outside inline code. */
export function splitRow(line: string): string[] {
  let body = line.trim();

  if (body.startsWith("|")) {
    body = body.slice(1);
  }

  if (body.endsWith("|") && !body.endsWith("\\|")) {
    body = body.slice(0, -1);
  }

  const cells: string[] = [];
  let current = "";
  let inCode = false;

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i] ?? "";

    if (char === "\\" && i + 1 < body.length) {
      current += char + (body[i + 1] ?? "");
      i += 1;
      continue;
    }

    if (char === "`") {
      inCode = !inCode;
    }

    if (char === "|" && !inCode) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());

  return cells;
}

const DELIMITER_CELL = /^:?-+:?$/;

export function isDelimiterRow(line: string): boolean {
  if (!line.includes("-")) {
    return false;
  }

  const cells = splitRow(line);

  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell.replace(/\s/g, "")));
}

function alignOf(cell: string): Align {
  const compact = cell.replace(/\s/g, "");
  const left = compact.startsWith(":");
  const right = compact.endsWith(":");

  if (left && right) {
    return "center";
  }

  if (right) {
    return "right";
  }

  return left ? "left" : "none";
}

function pad(text: string, width: number, align: Align): string {
  const gap = Math.max(0, width - displayWidth(text));

  if (align === "right") {
    return " ".repeat(gap) + text;
  }

  if (align === "center") {
    const left = Math.floor(gap / 2);

    return " ".repeat(left) + text + " ".repeat(gap - left);
  }

  return text + " ".repeat(gap);
}

function delimiter(width: number, align: Align): string {
  const dashes = Math.max(3, width);

  if (align === "center") {
    return `:${"-".repeat(Math.max(1, dashes - 2))}:`;
  }

  if (align === "right") {
    return `${"-".repeat(dashes - 1)}:`;
  }

  if (align === "left") {
    return `:${"-".repeat(dashes - 1)}`;
  }

  return "-".repeat(dashes);
}

/** Re-aligns a table. Returns null when the lines are not a table. */
export function formatTableLines(lines: string[]): string[] | null {
  if (lines.length < 2 || !isDelimiterRow(lines[1] ?? "")) {
    return null;
  }

  const indent = /^\s*/.exec(lines[0] ?? "")?.[0] ?? "";
  const rows = lines.map(splitRow);
  const aligns = (rows[1] ?? []).map(alignOf);
  const columns = Math.max(...rows.map((row) => row.length));
  const widths: number[] = Array.from({ length: columns }, () => 3);

  rows.forEach((row, index) => {
    if (index === 1) {
      return;
    }

    for (let c = 0; c < columns; c += 1) {
      widths[c] = Math.max(widths[c] ?? 3, displayWidth(row[c] ?? ""));
    }
  });

  return rows.map((row, index) => {
    const cells: string[] = [];

    for (let c = 0; c < columns; c += 1) {
      const align = aligns[c] ?? "none";
      const width = widths[c] ?? 3;
      cells.push(index === 1 ? delimiter(width, align) : pad(row[c] ?? "", width, align));
    }

    return `${indent}| ${cells.join(" | ")} |`;
  });
}

/** Finds the table block around a 0-based line index. */
export function findTableBlock(lines: string[], at: number): { start: number; end: number } | null {
  const isRow = (line: string | undefined) => line !== undefined && line.includes("|") && line.trim() !== "";

  if (!isRow(lines[at])) {
    return null;
  }

  let start = at;
  let end = at;

  while (start > 0 && isRow(lines[start - 1])) {
    start -= 1;
  }

  while (end + 1 < lines.length && isRow(lines[end + 1])) {
    end += 1;
  }

  if (end - start < 1 || !isDelimiterRow(lines[start + 1] ?? "")) {
    return null;
  }

  return { start, end };
}
