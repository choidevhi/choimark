import { commands, type Command } from "./commands";
import { zoom } from "./actions";

const CODE_KEYS: Partial<Record<string, string>> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  IntlBackslash: "\\",
  IntlYen: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  NumpadAdd: "=",
  NumpadSubtract: "-",
  NumpadEnter: "Enter",
};

/**
 * Builds "Ctrl+Alt+Shift+Key" from physical key codes, so shortcuts work
 * while the Korean IME is in Hangul mode (event.key would be "ㄴ" for S).
 */
export function comboFromEvent(event: KeyboardEvent): string {
  let key: string;

  if (event.code.startsWith("Key")) {
    key = event.code.slice(3);
  } else if (event.code.startsWith("Digit")) {
    key = event.code.slice(5);
  } else if (/^F\d{1,2}$/.test(event.code)) {
    key = event.code;
  } else {
    key = CODE_KEYS[event.code] ?? event.key;
  }

  const parts: string[] = [];

  if (event.ctrlKey || event.metaKey) {
    parts.push("Ctrl");
  }

  if (event.altKey) {
    parts.push("Alt");
  }

  if (event.shiftKey) {
    parts.push("Shift");
  }

  parts.push(key);

  return parts.join("+");
}

// WebView2 browser shortcuts that would reload, print, open find bars or
// navigate the app page if nothing else handled them.
const BROWSER_KEYS = new Set([
  "F5",
  "Ctrl+F5",
  "Ctrl+R",
  "Ctrl+Shift+R",
  "Ctrl+P",
  "Ctrl+Shift+P",
  "Ctrl+F",
  "Ctrl+G",
  "Ctrl+Shift+G",
  "F3",
  "Shift+F3",
  "F7",
  "F12",
  "Ctrl+U",
  "Ctrl+J",
  "Ctrl+H",
  "Ctrl+S",
  "Ctrl+O",
  "Ctrl+N",
  "Ctrl+Shift+N",
  "Ctrl+Shift+I",
  "Ctrl+Shift+J",
  "Ctrl+Shift+C",
  "Ctrl+Shift+Delete",
  "Alt+ArrowLeft",
  "Alt+ArrowRight",
  "Ctrl+=",
  "Ctrl+-",
  "Ctrl+0",
  "BrowserBack",
  "BrowserForward",
]);

function buildKeyMap(): Map<string, Command> {
  const map = new Map<string, Command>();

  for (const command of commands) {
    if (command.keys === undefined || command.editorKey === true || command.keys === "Alt+F4") {
      continue;
    }

    map.set(command.keys, command);
  }

  return map;
}

export function installKeyHandling(): () => void {
  const keyMap = buildKeyMap();

  const onCapture = (event: KeyboardEvent) => {
    if (event.isComposing) {
      return;
    }

    const command = keyMap.get(comboFromEvent(event));

    if (command === undefined) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    command.run();
  };

  const onBubble = (event: KeyboardEvent) => {
    if (!event.defaultPrevented && BROWSER_KEYS.has(comboFromEvent(event))) {
      event.preventDefault();
    }
  };

  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();
    zoom(event.deltaY < 0 ? 1 : -1);
  };

  const onMouseUp = (event: MouseEvent) => {
    // Mouse back/forward buttons would navigate the app page.
    if (event.button === 3 || event.button === 4) {
      event.preventDefault();
    }
  };

  window.addEventListener("keydown", onCapture, true);
  window.addEventListener("keydown", onBubble);
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("mouseup", onMouseUp);

  return () => {
    window.removeEventListener("keydown", onCapture, true);
    window.removeEventListener("keydown", onBubble);
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("mouseup", onMouseUp);
  };
}
