//! Commands invoked from the UI. File-opening commands take a download ID,
//! never a raw path, so the web view can't open arbitrary files.

use std::path::PathBuf;

use fetchlane_engine::{
    AddRequest, AddTorrentRequest, DeleteScope, DownloadError, DownloadView, Engine, ErrorKind,
    ProbeResult, QueueMove, Settings, Snapshot, Theme, TorrentDetails, TorrentPreview,
    TorrentSource,
};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

use crate::integration::{self, IntegrationStatus};
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    kind: ErrorKind,
    message: String,
}

impl From<DownloadError> for CommandError {
    fn from(e: DownloadError) -> Self {
        Self {
            kind: e.kind,
            message: e.message,
        }
    }
}

fn os_error(message: &str) -> CommandError {
    CommandError {
        kind: ErrorKind::FileSystem,
        message: message.to_string(),
    }
}

type CmdResult<T> = Result<T, CommandError>;

#[tauri::command]
pub fn list_downloads(state: State<'_, AppState>) -> Snapshot {
    state.engine.snapshot()
}

#[tauri::command]
pub async fn probe_url(
    state: State<'_, AppState>,
    url: String,
    dest_dir: Option<PathBuf>,
) -> CmdResult<ProbeResult> {
    Ok(state.engine.probe(&url, dest_dir.as_deref()).await?)
}

#[tauri::command]
pub fn add_download(state: State<'_, AppState>, request: AddRequest) -> CmdResult<DownloadView> {
    Ok(state.engine.add(request)?)
}

#[tauri::command]
pub fn pause_download(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    Ok(state.engine.pause(&id)?)
}

#[tauri::command]
pub fn resume_download(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    Ok(state.engine.resume(&id)?)
}

#[tauri::command]
pub fn cancel_download(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    Ok(state.engine.cancel(&id)?)
}

#[tauri::command]
pub async fn remove_download(
    state: State<'_, AppState>,
    id: String,
    delete_files: bool,
) -> CmdResult<()> {
    Ok(state.engine.remove(&id, delete_files).await?)
}

#[tauri::command]
pub fn start_now(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    Ok(state.engine.start_now(&id)?)
}

#[tauri::command]
pub fn retry_now(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    Ok(state.engine.retry_now(&id)?)
}

#[tauri::command]
pub fn restart_download(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    Ok(state.engine.restart(&id)?)
}

#[tauri::command]
pub fn move_in_queue(state: State<'_, AppState>, id: String, to: QueueMove) -> CmdResult<()> {
    Ok(state.engine.move_in_queue(&id, to)?)
}

/// Drag-and-drop reordering: `position` is 1-based in the queue.
#[tauri::command]
pub fn move_to_position(state: State<'_, AppState>, id: String, position: u32) -> CmdResult<()> {
    Ok(state.engine.move_to_position(&id, position)?)
}

/// Full link, including hidden parameters, for the reveal toggle.
#[tauri::command]
pub fn get_source_url(state: State<'_, AppState>, id: String) -> CmdResult<String> {
    Ok(state.engine.source_url(&id)?)
}

/// "Copy link": puts the full link on the clipboard without sending it
/// through the web view.
#[tauri::command]
pub fn copy_source_url(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let url = state.engine.source_url(&id)?;
    app.clipboard()
        .write_text(url)
        .map_err(|_| os_error("The link couldn't be copied to the clipboard."))
}

/// Free bytes on the drive holding `path`; null if unknown.
#[tauri::command]
pub fn free_space(path: PathBuf) -> Option<u64> {
    Engine::free_space(&path)
}

#[tauri::command]
pub async fn clear_finished(state: State<'_, AppState>) -> CmdResult<()> {
    state.engine.clear_finished().await;
    Ok(())
}

/// Read a .torrent file or fetch a magnet link's details. `probe_id` lets
/// `cancel_torrent_probe` stop a magnet fetch.
#[tauri::command]
pub async fn probe_torrent(
    state: State<'_, AppState>,
    source: TorrentSource,
    probe_id: String,
    dest_dir: Option<PathBuf>,
) -> CmdResult<TorrentPreview> {
    Ok(state
        .engine
        .probe_torrent(source, &probe_id, dest_dir.as_deref())
        .await?)
}

#[tauri::command]
pub fn cancel_torrent_probe(state: State<'_, AppState>, probe_id: String) {
    state.engine.cancel_torrent_probe(&probe_id);
}

#[tauri::command]
pub async fn add_torrent(
    state: State<'_, AppState>,
    request: AddTorrentRequest,
) -> CmdResult<DownloadView> {
    Ok(state.engine.add_torrent(request).await?)
}

#[tauri::command]
pub async fn recheck_torrent(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    Ok(state.engine.recheck(&id).await?)
}

#[tauri::command]
pub async fn set_torrent_files(
    state: State<'_, AppState>,
    id: String,
    selected: Vec<usize>,
) -> CmdResult<()> {
    Ok(state.engine.set_torrent_files(&id, selected).await?)
}

#[tauri::command]
pub fn torrent_details(state: State<'_, AppState>, id: String) -> CmdResult<TorrentDetails> {
    Ok(state.engine.torrent_details(&id)?)
}

/// What "Delete downloaded files" would remove, for the confirmation.
#[tauri::command]
pub fn delete_scope(state: State<'_, AppState>, id: String) -> CmdResult<DeleteScope> {
    Ok(state.engine.delete_scope(&id)?)
}

#[tauri::command]
pub fn pause_all(state: State<'_, AppState>) {
    state.engine.pause_all();
}

#[tauri::command]
pub fn resume_all(state: State<'_, AppState>) {
    state.engine.resume_all();
}

#[tauri::command]
pub fn open_file(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    open_target(&app, &state.engine, &id)
}

#[tauri::command]
pub fn show_in_folder(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    reveal(&app, &state.engine, &id)
}

/// Open a completed download with its default app.
pub fn open_target(app: &AppHandle, engine: &Engine, id: &str) -> CmdResult<()> {
    let path = engine.completed_file(id)?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|_| os_error("Windows couldn't open this file. There may be no app installed for this file type."))
}

/// Select a download's file in Explorer, or open its folder.
pub fn reveal(app: &AppHandle, engine: &Engine, id: &str) -> CmdResult<()> {
    let target = engine.reveal_target(id)?;
    let result = if target.is_file() {
        app.opener().reveal_item_in_dir(&target)
    } else {
        app.opener()
            .open_path(target.to_string_lossy(), None::<&str>)
    };
    result.map_err(|_| os_error("The folder couldn't be opened."))
}

/// Where the browser extension is: bundled next to the app, or in the source
/// tree for development builds.
pub fn extension_dir(app: &AppHandle) -> Option<PathBuf> {
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join("browser-extension"));
    let source = cfg!(debug_assertions)
        .then(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../browser-extension"));
    bundled
        .into_iter()
        .chain(source)
        .find(|d| d.join("manifest.json").is_file())
        .map(|d| dunce_path(&d))
}

/// Tidy `..` out of a path for display.
fn dunce_path(p: &std::path::Path) -> PathBuf {
    let s = p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    let text = s.to_string_lossy();
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text))
}

#[tauri::command]
pub fn integration_status(app: AppHandle) -> IntegrationStatus {
    integration::status(extension_dir(&app))
}

#[tauri::command]
pub fn set_magnet_handler(app: AppHandle, enabled: bool) -> CmdResult<IntegrationStatus> {
    integration::set_magnet_handler(enabled)
        .map_err(|_| os_error("Windows didn't allow changing the app for magnet links."))?;
    Ok(integration::status(extension_dir(&app)))
}

/// Show the extension folder, for "Load unpacked" in the browser.
#[tauri::command]
pub fn show_extension_folder(app: AppHandle) -> CmdResult<()> {
    let dir = extension_dir(&app).ok_or_else(|| {
        os_error("The browser extension isn't included in this copy of Fetchlane.")
    })?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|_| os_error("The folder couldn't be opened."))
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.engine.settings()
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> CmdResult<Settings> {
    let saved = state.engine.update_settings(settings)?;
    apply_theme(&app, saved.theme);
    Ok(saved)
}

/// Match the native title bar to the chosen theme (System follows Windows).
pub fn apply_theme(app: &AppHandle, theme: Theme) {
    let native = match theme {
        Theme::System => None,
        Theme::Light => Some(tauri::Theme::Light),
        Theme::Dark => Some(tauri::Theme::Dark),
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_theme(native);
    }
}
