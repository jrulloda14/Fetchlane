//! Durable JSON storage for the download list and settings.
//!
//! Files are replaced atomically (write temp file, fsync, rename) so a crash
//! leaves either the old or the new version, never a torn file.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::model::{DownloadRecord, Settings};

const DOWNLOADS_FILE: &str = "downloads.json";
const SETTINGS_FILE: &str = "settings.json";
const FORMAT_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadsFile {
    version: u32,
    downloads: Vec<DownloadRecord>,
    #[serde(default)]
    queue_held: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadsFileRef<'a> {
    version: u32,
    downloads: &'a [&'a DownloadRecord],
    queue_held: bool,
}

pub(crate) struct Store {
    dir: PathBuf,
    /// Serializes writers so an older snapshot never overwrites a newer one.
    write_lock: Mutex<()>,
}

impl Store {
    pub fn new(dir: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&dir)?;
        Ok(Self {
            dir,
            write_lock: Mutex::new(()),
        })
    }

    pub fn downloads_path(&self) -> PathBuf {
        self.dir.join(DOWNLOADS_FILE)
    }

    /// The saved download list and whether the queue was on hold.
    pub fn load_downloads(&self) -> (Vec<DownloadRecord>, bool) {
        match read_json::<DownloadsFile>(&self.downloads_path()) {
            Ok(Some(file)) => (file.downloads, file.queue_held),
            Ok(None) => (Vec::new(), false),
            Err(e) => {
                tracing::error!("download list unreadable, starting empty: {e}");
                quarantine(&self.downloads_path());
                (Vec::new(), false)
            }
        }
    }

    pub fn load_settings(&self) -> Settings {
        let path = self.dir.join(SETTINGS_FILE);
        match read_json::<Settings>(&path) {
            Ok(Some(s)) => s,
            Ok(None) => Settings::default(),
            Err(e) => {
                tracing::error!("settings unreadable, using defaults: {e}");
                quarantine(&path);
                Settings::default()
            }
        }
    }

    /// Snapshot under the write lock, then write. `snapshot` is called with
    /// the lock held so writes land in the same order snapshots were taken.
    pub fn save_downloads_with(
        &self,
        snapshot: impl FnOnce() -> (Vec<DownloadRecord>, bool),
    ) -> io::Result<()> {
        let _guard = self.write_lock.lock().unwrap_or_else(|p| p.into_inner());
        let (records, queue_held) = snapshot();
        let refs: Vec<&DownloadRecord> = records.iter().collect();
        let bytes = serde_json::to_vec_pretty(&DownloadsFileRef {
            version: FORMAT_VERSION,
            downloads: &refs,
            queue_held,
        })
        .map_err(io::Error::other)?;
        write_atomic(&self.downloads_path(), &bytes)
    }

    pub fn save_settings(&self, settings: &Settings) -> io::Result<()> {
        let bytes = serde_json::to_vec_pretty(settings).map_err(io::Error::other)?;
        write_atomic(&self.dir.join(SETTINGS_FILE), &bytes)
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> io::Result<Option<T>> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(io::Error::other),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

fn quarantine(path: &Path) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = fs::rename(path, path.with_extension(format!("corrupt-{stamp}.json")));
}

pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    // Antivirus or indexers can briefly hold the target open on Windows.
    let mut last_err = None;
    for attempt in 0..5 {
        match fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
                std::thread::sleep(std::time::Duration::from_millis(20 * (attempt + 1)));
            }
        }
    }
    let _ = fs::remove_file(&tmp);
    Err(last_err.expect("loop ran at least once"))
}
