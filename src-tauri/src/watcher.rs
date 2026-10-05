//! Watches open documents for changes made by other programs.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

fn key(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").to_lowercase()
}

/// Every change to a watched file is forwarded. The frontend debounces and
/// compares the disk content with what it last saved, which also covers the
/// events caused by our own saves.
#[derive(Default)]
struct Shared {
    /// normalized path -> path as the frontend knows it
    files: HashMap<String, String>,
}

#[derive(Default)]
pub struct FileWatcher {
    shared: Arc<Mutex<Shared>>,
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    watcher: Option<RecommendedWatcher>,
    dirs: HashMap<PathBuf, usize>,
}

impl FileWatcher {
    fn ensure_watcher(&self, inner: &mut Inner, app: &AppHandle) -> Result<(), String> {
        if inner.watcher.is_some() {
            return Ok(());
        }

        let shared = Arc::clone(&self.shared);
        let app = app.clone();
        let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else {
                return;
            };

            if event.kind.is_access() {
                return;
            }

            let mut changed = Vec::new();

            if let Ok(state) = shared.lock() {
                for path in &event.paths {
                    if let Some(original) = state.files.get(&key(path)) {
                        if !changed.contains(original) {
                            changed.push(original.clone());
                        }
                    }
                }
            }

            for path in changed {
                let _ = app.emit("file-changed", path);
            }
        })
        .map_err(|e| e.to_string())?;

        inner.watcher = Some(watcher);

        Ok(())
    }

    pub fn watch(&self, app: &AppHandle, path: &str) -> Result<(), String> {
        let file = PathBuf::from(path);
        let Some(dir) = file.parent().map(Path::to_path_buf) else {
            return Ok(());
        };
        let k = key(&file);

        {
            let mut state = self.shared.lock().map_err(|e| e.to_string())?;

            if state.files.contains_key(&k) {
                return Ok(());
            }

            state.files.insert(k, path.to_string());
        }

        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        self.ensure_watcher(&mut inner, app)?;
        let count = inner.dirs.entry(dir.clone()).or_insert(0);
        *count += 1;

        if *count == 1 {
            if let Some(w) = inner.watcher.as_mut() {
                w.watch(&dir, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
            }
        }

        Ok(())
    }

    pub fn unwatch(&self, path: &str) -> Result<(), String> {
        let file = PathBuf::from(path);
        let k = key(&file);

        {
            let mut state = self.shared.lock().map_err(|e| e.to_string())?;

            if state.files.remove(&k).is_none() {
                return Ok(());
            }
        }

        let Some(dir) = file.parent().map(Path::to_path_buf) else {
            return Ok(());
        };
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        let remaining = match inner.dirs.get_mut(&dir) {
            Some(count) => {
                *count = count.saturating_sub(1);
                *count
            }
            None => return Ok(()),
        };

        if remaining == 0 {
            inner.dirs.remove(&dir);

            if let Some(w) = inner.watcher.as_mut() {
                let _ = w.unwatch(&dir);
            }
        }

        Ok(())
    }
}
