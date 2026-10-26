// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::fs::{self, File};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use std::collections::HashSet;

use fetchlane_engine::{Engine, EngineConfig, Snapshot};
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::broadcast::error::RecvError;

pub struct AppState {
    pub engine: Engine,
}

/// Set once the app has begun shutting down the engine.
static EXITING: AtomicBool = AtomicBool::new(false);

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

fn init_logging(log_dir: &Path) {
    let _ = fs::create_dir_all(log_dir);
    let path = log_dir.join("fetchlane.log");
    if fs::metadata(&path).is_ok_and(|m| m.len() > MAX_LOG_BYTES) {
        let _ = fs::rename(&path, log_dir.join("fetchlane.old.log"));
    }
    let Ok(file) = File::options().create(true).append(true).open(&path) else {
        return;
    };
    let _ = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_max_level(tracing::Level::INFO)
        .with_writer(Mutex::new(file))
        .try_init();
}

/// Downloads that have finished (completed, or a torrent that is seeding).
fn finished_ids(snap: &Snapshot) -> HashSet<String> {
    snap.downloads
        .iter()
        .filter(|d| d.completed_at.is_some())
        .map(|d| d.id.clone())
        .collect()
}

/// Show a notification for each download that finished since `before`.
fn notify_finished(app: &AppHandle, snap: &Snapshot, before: &HashSet<String>) {
    for d in snap
        .downloads
        .iter()
        .filter(|d| d.completed_at.is_some() && !before.contains(&d.id))
    {
        let _ = app
            .notification()
            .builder()
            .title("Download finished")
            .body(&d.file_name)
            .show();
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            init_logging(
                &app.path()
                    .app_log_dir()
                    .unwrap_or_else(|_| data_dir.clone()),
            );
            let engine = tauri::async_runtime::block_on(Engine::open(
                data_dir.join("state"),
                EngineConfig::default(),
            ))?;

            // Forward engine changes to the window, coalesced to ~10/s.
            let handle = app.handle().clone();
            let mut changes = engine.subscribe();
            let forward = engine.clone();
            let mut finished = finished_ids(&engine.snapshot());
            tauri::async_runtime::spawn(async move {
                loop {
                    match changes.recv().await {
                        Ok(()) | Err(RecvError::Lagged(_)) => {}
                        Err(RecvError::Closed) => break,
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    while changes.try_recv().is_ok() {}
                    let snap = forward.snapshot();
                    if forward.settings().notify_on_finish {
                        notify_finished(&handle, &snap, &finished);
                    }
                    finished = finished_ids(&snap);
                    let _ = handle.emit("downloads-changed", snap);
                }
            });

            commands::apply_theme(app.handle(), engine.settings().theme);
            app.manage(AppState { engine });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_downloads,
            commands::probe_url,
            commands::add_download,
            commands::pause_download,
            commands::resume_download,
            commands::start_now,
            commands::retry_now,
            commands::restart_download,
            commands::move_in_queue,
            commands::move_to_position,
            commands::cancel_download,
            commands::remove_download,
            commands::get_source_url,
            commands::copy_source_url,
            commands::free_space,
            commands::probe_torrent,
            commands::cancel_torrent_probe,
            commands::add_torrent,
            commands::recheck_torrent,
            commands::set_torrent_files,
            commands::torrent_details,
            commands::delete_scope,
            commands::clear_finished,
            commands::pause_all,
            commands::resume_all,
            commands::open_file,
            commands::show_in_folder,
            commands::get_settings,
            commands::update_settings,
        ])
        .build(tauri::generate_context!())
        .expect("failed to start Fetchlane");

    app.run(|handle, event| {
        if let RunEvent::ExitRequested { api, .. } = &event {
            // Let workers checkpoint their progress before the process ends.
            if !EXITING.swap(true, Ordering::SeqCst) {
                api.prevent_exit();
                let handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(state) = handle.try_state::<AppState>() {
                        state.engine.shutdown().await;
                    }
                    handle.exit(0);
                });
            }
        }
    });
}
