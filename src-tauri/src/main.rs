// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::fs::{self, File};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use fetchlane_engine::{Engine, EngineConfig};
use tauri::{Emitter, Manager, RunEvent};
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

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
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
            tauri::async_runtime::spawn(async move {
                loop {
                    match changes.recv().await {
                        Ok(()) | Err(RecvError::Lagged(_)) => {}
                        Err(RecvError::Closed) => break,
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    while changes.try_recv().is_ok() {}
                    let _ = handle.emit("downloads-changed", forward.snapshot());
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
