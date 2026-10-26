//! "Download finished" notifications.
//!
//! On Windows, Fetchlane registers its own notification identity (name and
//! icon) under `HKCU\Software\Classes\AppUserModelId`, so toasts come from
//! "Fetchlane" even when the app isn't installed. Without it, Windows would
//! show them as coming from Windows PowerShell.

use std::collections::HashSet;

use fetchlane_engine::{DownloadKind, DownloadView, Snapshot, TorrentState};
use tauri::{AppHandle, Manager};

/// Downloads that have finished (completed, or a torrent that is seeding).
pub fn finished_ids(snap: &Snapshot) -> HashSet<String> {
    snap.downloads
        .iter()
        .filter(|d| d.completed_at.is_some())
        .map(|d| d.id.clone())
        .collect()
}

/// More than this many at once are summed up in one notification.
const MAX_SEPARATE: usize = 2;

/// Show a notification for the downloads that finished since `before`.
pub fn notify_finished(app: &AppHandle, snap: &Snapshot, before: &HashSet<String>) {
    let done: Vec<&DownloadView> = snap
        .downloads
        .iter()
        .filter(|d| d.completed_at.is_some() && !before.contains(&d.id))
        .collect();
    if done.is_empty() {
        return;
    }
    let toasts = if done.len() > MAX_SEPARATE {
        vec![summary(&done)]
    } else {
        done.iter().map(|d| single(d)).collect()
    };
    for t in toasts {
        imp::show(app, t);
    }
}

/// What a notification says and offers.
#[derive(Debug, Clone, PartialEq)]
pub struct Toast {
    pub title: String,
    pub line1: String,
    pub line2: Option<String>,
    /// The download to open, reveal or select. `None` for a summary.
    pub id: Option<String>,
}

fn single(d: &DownloadView) -> Toast {
    let size = d.total_size.unwrap_or(d.downloaded);
    let folder = folder_name(&d.dest_dir);
    match d.kind {
        DownloadKind::Direct => Toast {
            title: d.file_name.clone(),
            line1: format!("Download finished · {}", fmt_size(size)),
            line2: Some(format!("Saved in {folder}")),
            id: Some(d.id.clone()),
        },
        DownloadKind::Torrent => {
            let seeding = d
                .torrent
                .as_ref()
                .is_some_and(|t| t.state == TorrentState::Seeding);
            Toast {
                title: d.file_name.clone(),
                line1: format!("Torrent finished · {}", fmt_size(size)),
                line2: Some(if seeding {
                    format!("Saved in {folder} · now seeding")
                } else {
                    format!("Saved in {folder}")
                }),
                id: Some(d.id.clone()),
            }
        }
    }
}

fn summary(done: &[&DownloadView]) -> Toast {
    let total: u64 = done
        .iter()
        .map(|d| d.total_size.unwrap_or(d.downloaded))
        .sum();
    let names: Vec<&str> = done.iter().take(2).map(|d| d.file_name.as_str()).collect();
    let more = done.len() - names.len();
    Toast {
        title: format!("{} downloads finished", done.len()),
        line1: format!("{} in total", fmt_size(total)),
        line2: Some(format!("{} and {more} more", names.join(", "))),
        id: None,
    }
}

fn folder_name(dir: &std::path::Path) -> String {
    match dir.file_name() {
        Some(name) => name.to_string_lossy().into_owned(),
        // A drive root such as D:\
        None => dir
            .to_string_lossy()
            .trim_end_matches(['\\', '/'])
            .to_string(),
    }
}

/// Sizes the way the UI shows them ("1.6 MB", "5.91 GB").
pub fn fmt_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["KB", "MB", "GB", "TB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut v = bytes as f64 / 1024.0;
    let mut unit = 0;
    while v >= 1024.0 && unit < UNITS.len() - 1 {
        v /= 1024.0;
        unit += 1;
    }
    let digits = if v >= 100.0 || unit == 0 {
        0
    } else if unit >= 2 && v < 10.0 {
        2
    } else {
        1
    };
    format!("{v:.digits$} {}", UNITS[unit])
}

/// Bring the main window forward and, optionally, select a download.
pub fn focus_main(app: &AppHandle, select: Option<&str>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    if let Some(id) = select {
        use tauri::Emitter;
        let _ = app.emit("focus-download", id);
    }
}

#[cfg(windows)]
mod imp {
    use std::path::{Path, PathBuf};

    use tauri::{AppHandle, Manager};
    use tauri_winrt_notification::{IconCrop, Toast as WinToast};
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const ICON: &[u8] = include_bytes!("../icons/128x128.png");

    /// Register Fetchlane's notification identity. Cheap; run at startup.
    pub fn register(app: &AppHandle) {
        if let Err(e) = try_register(app) {
            tracing::warn!("couldn't register the notification identity: {e}");
        }
    }

    fn icon_path(app: &AppHandle) -> Option<PathBuf> {
        Some(
            app.path()
                .app_local_data_dir()
                .ok()?
                .join("notification-icon.png"),
        )
    }

    fn try_register(app: &AppHandle) -> std::io::Result<()> {
        let icon = icon_path(app).ok_or_else(|| std::io::Error::other("no data folder"))?;
        if let Some(dir) = icon.parent() {
            std::fs::create_dir_all(dir)?;
        }
        if std::fs::read(&icon).ok().as_deref() != Some(ICON) {
            std::fs::write(&icon, ICON)?;
        }
        let id = &app.config().identifier;
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(format!(r"Software\Classes\AppUserModelId\{id}"))?;
        key.set_value("DisplayName", &"Fetchlane")?;
        key.set_value("IconUri", &icon.to_string_lossy().into_owned())?;
        Ok(())
    }

    pub fn show(app: &AppHandle, t: super::Toast) {
        let app = app.clone();
        // WinRT calls block briefly; keep them off the async runtime.
        std::thread::spawn(move || {
            let id = app.config().identifier.clone();
            let mut toast = WinToast::new(&id).title(&t.title).text1(&t.line1);
            if let Some(l2) = &t.line2 {
                toast = toast.text2(l2);
            }
            if let Some(icon) = icon_path(&app).filter(|p| p.is_file()) {
                toast = toast.icon(Path::new(&icon), IconCrop::Square, "Fetchlane");
            }
            match &t.id {
                Some(dl) => {
                    toast = toast
                        .add_button("Open", &format!("open:{dl}"))
                        .add_button("Show in folder", &format!("reveal:{dl}"));
                }
                None => {
                    toast = toast.add_button("Show downloads", "show");
                }
            }
            let handle = app.clone();
            let select = t.id.clone();
            toast = toast.on_activated(move |action| {
                super::activate(&handle, action.as_deref(), select.as_deref());
                Ok(())
            });
            if let Err(e) = toast.show() {
                tracing::warn!("couldn't show a notification: {e}");
            }
        });
    }
}

#[cfg(not(windows))]
mod imp {
    use tauri::AppHandle;
    use tauri_plugin_notification::NotificationExt;

    pub fn register(_app: &AppHandle) {}

    pub fn show(app: &AppHandle, t: super::Toast) {
        let body = match &t.line2 {
            Some(l2) => format!("{}\n{l2}", t.line1),
            None => t.line1.clone(),
        };
        let _ = app
            .notification()
            .builder()
            .title(&t.title)
            .body(body)
            .show();
    }
}

pub use imp::register;

/// A click on a notification or one of its buttons.
#[cfg_attr(not(windows), allow(dead_code))]
fn activate(app: &AppHandle, action: Option<&str>, select: Option<&str>) {
    let Some(state) = app.try_state::<crate::AppState>() else {
        return;
    };
    match action.and_then(|a| a.split_once(':')) {
        Some(("open", id)) => {
            if crate::commands::open_target(app, &state.engine, id).is_err() {
                focus_main(app, Some(id));
            }
        }
        Some(("reveal", id)) => {
            let _ = crate::commands::reveal(app, &state.engine, id);
        }
        _ => focus_main(app, select),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_match_the_ui() {
        assert_eq!(fmt_size(500), "500 B");
        assert_eq!(fmt_size((1.6 * 1024.0 * 1024.0) as u64), "1.6 MB");
        assert_eq!(fmt_size((5.91 * 1024f64.powi(3)) as u64), "5.91 GB");
        assert_eq!(fmt_size(150 * 1024 * 1024), "150 MB");
    }

    #[test]
    fn folder_names() {
        use std::path::Path;
        assert_eq!(
            folder_name(Path::new(r"C:\Users\me\Downloads")),
            "Downloads"
        );
        assert_eq!(folder_name(Path::new("/home/me/dl/")), "dl");
        #[cfg(windows)]
        assert_eq!(folder_name(Path::new(r"D:\")), "D:");
    }
}
