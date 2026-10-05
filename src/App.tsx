import { useEffect } from "react";

import { bootstrap } from "./app/bootstrap";
import { CommandPalette } from "./components/CommandPalette";
import { ConflictBanner, ContextMenu, Dialog, DropOverlay, Toasts } from "./components/Overlays";
import { Panes } from "./components/Panes";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { Toolbar } from "./components/Toolbar";
import { cx } from "./components/ui";
import { Welcome } from "./components/Welcome";
import { useApp } from "./state/store";

export function App() {
  const sidebarOpen = useApp((s) => s.settings.sidebarOpen);
  const focusMode = useApp((s) => s.focusMode);
  const hasDoc = useApp((s) => s.activeId !== null);

  useEffect(() => {
    void bootstrap();
  }, []);

  return (
    <div className={cx("app", focusMode && "focus-mode", !hasDoc && "no-doc")}>
      <TitleBar />
      <div className="workspace">
        {sidebarOpen && !focusMode ? <Sidebar /> : null}
        <main className="main">
          {focusMode ? null : <Toolbar />}
          <ConflictBanner />
          <div className="main-body">
            <Panes />
            {hasDoc ? null : <Welcome />}
          </div>
        </main>
      </div>
      {focusMode ? null : <StatusBar />}
      <CommandPalette />
      <SettingsDialog />
      <Dialog />
      <ContextMenu />
      <Toasts />
      <DropOverlay />
    </div>
  );
}
