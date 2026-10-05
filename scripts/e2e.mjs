// End-to-end check of the real app. Launches choimark.exe with WebView2
// remote debugging, drives it through playwright-core over CDP, and writes
// screenshots to _shots/. The app profile goes to a temp folder so tests
// never touch the user's own settings, session or recent files.
//
//   node scripts/e2e.mjs [path\to\choimark.exe]

import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const exe = resolve(process.argv[2] ?? join(root, "src-tauri", "target", "debug", "choimark.exe"));
const shots = join(root, "_shots");
const port = 9333;
const work = mkdtempSync(join(tmpdir(), "choimark-e2e-"));
const profile = join(work, "profile");
const docs = join(work, "docs");

mkdirSync(shots, { recursive: true });
mkdirSync(docs, { recursive: true });

for (const name of ["sample.md", "legacy-euckr.md", "evil.md"]) {
  copyFileSync(join(here, "fixtures", name), join(docs, name));
}

const env = {
  ...process.env,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  WEBVIEW2_USER_DATA_FOLDER: profile,
};

const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : `  (${detail})`}`);
}

async function check(name, run) {
  try {
    const detail = await run();
    record(name, true, typeof detail === "string" ? detail : "");
  } catch (cause) {
    record(name, false, cause instanceof Error ? cause.message.split("\n")[0] : String(cause));
  }
}

function launch(args) {
  return spawn(exe, args, { env, stdio: "ignore", detached: false });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForCdp() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);

      if (res.ok) {
        return;
      }
    } catch {
      // not up yet
    }

    await sleep(250);
  }

  throw new Error("CDP endpoint did not come up");
}

async function waitFor(fn, timeout = 6000, label = "condition") {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await fn()) {
      return;
    }

    await sleep(80);
  }

  throw new Error(`timed out waiting for ${label}`);
}

const sample = join(docs, "sample.md");
const legacy = join(docs, "legacy-euckr.md");
const evil = join(docs, "evil.md");
const app = launch([sample]);
let browser = null;

try {
  await waitForCdp();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  let page = null;

  await waitFor(async () => {
    page = context.pages().find((p) => /tauri\.localhost|localhost/.test(p.url())) ?? null;

    return page !== null;
  }, 15000, "app page");

  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });

  await page.waitForSelector(".markdown-body h1", { timeout: 15000 });
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);

  const text = (selector) => page.locator(selector).first().innerText();
  const count = (selector) => page.locator(selector).count();

  await check("opens the file passed on the command line", async () => {
    const title = await text(".tab.active .tab-title");

    if (title !== "sample.md") {
      throw new Error(`tab title ${title}`);
    }
  });

  await check("window controls maximize and restore", async () => {
    const button = page.locator(".window-controls .wc").nth(1);
    const before = await button.getAttribute("aria-label");
    await button.click();
    await waitFor(async () => (await button.getAttribute("aria-label")) !== before, 4000, "maximize toggle");
    await button.click();
    await waitFor(async () => (await button.getAttribute("aria-label")) === before, 4000, "restore toggle");
  });

  await check("window title follows the active document", async () => {
    const title = await page.title();

    if (title !== "sample.md - ChoiMark") {
      throw new Error(`title ${title}`);
    }
  });

  await check("renders headings, tables, code, math, alerts, footnotes", async () => {
    const h1 = await text(".markdown-body h1");

    if (!h1.includes("ChoiMark 둘러보기")) {
      throw new Error(`h1 ${h1}`);
    }

    const needed = {
      table: ".markdown-body .table-wrap table",
      highlightedCode: ".markdown-body .code-block .hljs-keyword",
      katex: ".markdown-body .katex",
      alert: ".markdown-body .markdown-alert-note",
      footnote: ".markdown-body .footnotes",
      task: ".markdown-body input.task-checkbox",
      frontMatter: ".markdown-body .front-matter",
    };

    for (const [label, selector] of Object.entries(needed)) {
      if ((await count(selector)) === 0) {
        throw new Error(`missing ${label}`);
      }
    }
  });

  await check("renders mermaid diagrams to SVG", async () => {
    await page.waitForSelector(".markdown-body .mermaid-svg svg", { timeout: 15000 });
  });

  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, "01-split-light.png") });

  await check("typing updates the preview and marks the tab dirty", async () => {
    await page.click(".cm-content");
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\n## 추가된 제목\n\n새 문단입니다.");
    await page.waitForSelector(".markdown-body h2:has-text('추가된 제목')", { timeout: 3000 });
    await waitFor(async () => (await count(".tab.active.dirty")) === 1, 2000, "dirty tab");
  });

  await check("Ctrl+S writes the file and clears the dirty mark", async () => {
    await page.keyboard.press("Control+s");
    await waitFor(async () => (await count(".tab.active.dirty")) === 0, 4000, "clean tab");
    const disk = readFileSync(sample, "utf8");

    if (!disk.includes("## 추가된 제목")) {
      throw new Error("saved text missing");
    }
  });

  await check("clicking a preview checkbox edits the source", async () => {
    const box = page.locator(".markdown-body input.task-checkbox").nth(1);
    await box.click();
    await waitFor(async () => (await page.locator(".markdown-body input.task-checkbox").nth(1).isChecked()), 3000, "checked box");
    await page.keyboard.press("Control+s");
    await waitFor(async () => readFileSync(sample, "utf8").includes("- [x] 표 정렬"), 4000, "task saved");
  });

  await check("Ctrl+B wraps the word under the cursor", async () => {
    await page.click(".cm-content");
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\n굵게바꿀단어");
    await page.keyboard.press("Control+b");
    await page.waitForSelector(".markdown-body strong:has-text('굵게바꿀단어')", { timeout: 3000 });
  });

  await check("editor scroll moves the preview (sync scroll)", async () => {
    await page.evaluate(() => {
      const scroller = document.querySelector(".cm-scroller");

      if (scroller !== null) {
        scroller.scrollTop = 0;
      }
    });

    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const scroller = document.querySelector(".cm-scroller");

      if (scroller !== null) {
        scroller.scrollTop = 700;
      }
    });

    await page.waitForTimeout(400);
    const top = await page.evaluate(() => document.querySelector(".preview-scroll")?.scrollTop ?? 0);

    if (top < 100) {
      throw new Error(`preview scrollTop ${top}`);
    }

    return `preview scrollTop ${Math.round(top)}`;
  });

  await check("a second launch opens the file in the running window (EUC-KR)", async () => {
    launch([legacy]);
    await waitFor(async () => (await page.locator(".tab-title", { hasText: "legacy-euckr.md" }).count()) === 1, 8000, "second tab");
    await page.waitForSelector(".markdown-body h1:has-text('옛날 문서')", { timeout: 4000 });
    const body = await text(".markdown-body");

    if (!body.includes("똠방각하, 펲시콜라")) {
      throw new Error("Hangul decoded wrong");
    }

    const status = await text(".statusbar");

    if (!status.includes("EUC-KR") || !status.includes("CRLF")) {
      throw new Error(`status bar: ${status}`);
    }
  });

  await check("saving keeps EUC-KR bytes and CRLF line endings", async () => {
    await page.click(".cm-content");
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n- 저장 후에도 EUC-KR");
    await page.keyboard.press("Control+s");
    await waitFor(async () => (await count(".tab.active.dirty")) === 0, 4000, "clean tab");
    // Node's EUC-KR decoder lacks the CP949 extensions (펲), so compare bytes:
    // the untouched original must survive byte for byte, then the new line.
    const bytes = readFileSync(legacy);
    const original = readFileSync(join(here, "fixtures", "legacy-euckr.md"));
    const added = new TextDecoder("euc-kr").decode(bytes.subarray(original.length));

    if (!bytes.subarray(0, original.length).equals(original) || !added.includes("저장 후에도 EUC-KR") || !added.includes("\r\n")) {
      throw new Error("bytes are not EUC-KR with CRLF");
    }

    let utf8Valid = true;

    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      utf8Valid = false;
    }

    if (utf8Valid) {
      throw new Error("file was rewritten as UTF-8");
    }
  });

  await check("reloads when another program changes a clean file", async () => {
    writeFileSync(legacy, Buffer.concat([readFileSync(legacy), Buffer.from("\r\n# EXT\r\n", "ascii")]));
    await page.waitForSelector(".markdown-body h1:has-text('EXT')", { timeout: 5000 });
  });

  await check("blocks scripts and event handlers in documents", async () => {
    launch([evil]);
    await waitFor(async () => (await page.locator(".tab-title", { hasText: "evil.md" }).count()) === 1, 8000, "evil tab");
    await page.waitForSelector(".markdown-body h1:has-text('보안 시험')", { timeout: 4000 });
    await page.waitForTimeout(500);
    const pwned = await page.evaluate(() => "__pwned" in window);
    const iframes = await count(".markdown-body iframe");
    const scripts = await count(".markdown-body script");

    if (pwned || iframes > 0 || scripts > 0) {
      throw new Error(`pwned=${pwned} iframes=${iframes} scripts=${scripts}`);
    }

    await page.locator(".markdown-body a", { hasText: "나쁜 링크" }).click().catch(() => undefined);
    await page.waitForTimeout(300);

    if (await page.evaluate(() => "__pwned" in window)) {
      throw new Error("javascript: link ran");
    }
  });

  await check("command palette opens and runs commands", async () => {
    await page.keyboard.press("Control+Shift+P");
    await page.waitForSelector(".palette", { timeout: 2000 });
    await page.keyboard.type("미리보기만");
    await page.screenshot({ path: join(shots, "04-palette.png") });
    await page.keyboard.press("Enter");
    await waitFor(async () => (await count(".panes.mode-preview")) === 1, 2000, "preview mode");
  });

  await check("switches between tabs", async () => {
    await page.locator(".tab", { hasText: "sample.md" }).click();
    await page.waitForSelector(".markdown-body h1:has-text('ChoiMark 둘러보기')", { timeout: 3000 });
    await page.waitForSelector(".markdown-body .mermaid-svg svg", { timeout: 8000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(shots, "02-preview-light.png") });
  });

  await check("dark theme applies to app and preview", async () => {
    await page.keyboard.press("Control+Alt+2");
    await page.keyboard.press("Control+,");
    await page.waitForSelector(".settings", { timeout: 2000 });
    await page.locator(".settings .segment", { hasText: "어둡게" }).click();
    await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", 2000, "dark theme");
    await page.screenshot({ path: join(shots, "05-settings-dark.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(shots, "03-split-dark.png") });
  });

  await check("outline panel lists headings", async () => {
    await page.locator(".sidebar-tab", { hasText: "개요" }).click();
    const items = await count(".outline-item");

    if (items < 5) {
      throw new Error(`only ${items} headings`);
    }

    await page.screenshot({ path: join(shots, "06-outline-dark.png") });
  });

  await check("folder search finds text across files", async () => {
    await page.locator(".sidebar-tab", { hasText: "검색" }).click();
    await page.locator(".search-box input").fill("펲시콜라");
    await page.waitForSelector(".search-hit", { timeout: 5000 });
    await page.screenshot({ path: join(shots, "07-search-dark.png") });
  });

  await check("closing a dirty tab asks first", async () => {
    await page.click(".cm-content");
    await page.keyboard.type("x");
    await page.keyboard.press("Control+w");
    await page.waitForSelector(".dialog", { timeout: 2000 });
    await page.locator(".dialog .button", { hasText: "취소" }).click();
    await page.keyboard.press("Control+z");
  });

  await check("welcome screen after closing every tab", async () => {
    await page.keyboard.press("Control+,");
    await page.locator(".settings .segment", { hasText: "밝게" }).click();
    await page.keyboard.press("Escape");

    for (let i = 0; i < 6 && (await count(".tab")) > 0; i += 1) {
      await page.keyboard.press("Control+w");
      await page.waitForTimeout(150);

      if ((await count(".dialog")) > 0) {
        await page.locator(".dialog .button", { hasText: "저장 안 함" }).click();
      }
    }

    await page.waitForSelector(".welcome", { timeout: 3000 });
    await page.screenshot({ path: join(shots, "08-welcome-light.png") });
  });

  await check("no uncaught page errors", async () => {
    const real = errors.filter((message) => !message.includes("Failed to load resource"));

    if (real.length > 0) {
      throw new Error(real.slice(0, 3).join(" | "));
    }
  });
} catch (cause) {
  record("harness", false, cause instanceof Error ? cause.message : String(cause));
} finally {
  await browser?.close().catch(() => undefined);
  app.kill();
  spawn("taskkill", ["/IM", "choimark.exe", "/F"], { stdio: "ignore" });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed · screenshots in ${shots}`);
process.exit(failed === 0 ? 0 : 1);
