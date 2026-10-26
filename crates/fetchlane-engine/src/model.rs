//! Persisted and public data types.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::ErrorKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Queued,
    Downloading,
    Paused,
    Completed,
    Failed,
    Canceled,
}

/// What an active download is doing right now (only while a worker runs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Connecting,
    Transferring,
    Retrying,
    Finalizing,
    Stopping,
}

/// HTTP validators identifying the exact version of a resource.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Validators {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

impl Validators {
    pub fn strong_etag(&self) -> Option<&str> {
        self.etag.as_deref().filter(|e| !e.starts_with("W/"))
    }

    /// The validator to send in `If-Range`. Weak ETags are not allowed there.
    pub fn if_range(&self) -> Option<&str> {
        self.strong_etag().or(self.last_modified.as_deref())
    }
}

/// A byte range of the target file, `start..end` (end exclusive).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start: u64,
    pub end: u64,
    /// Bytes from `start` that are known to be durably on disk.
    pub done: u64,
}

/// How data is laid out in the partial file. Only checkpointed (fsync'd) byte
/// counts are stored here, so the record never claims more than is on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Layout {
    /// One sequential stream; the partial file holds `checkpoint` valid bytes.
    Single { checkpoint: u64 },
    /// Several ranges written into a preallocated file of the full size.
    Segmented { segments: Vec<Segment> },
}

impl Layout {
    pub fn fresh() -> Self {
        Layout::Single { checkpoint: 0 }
    }

    pub fn downloaded(&self) -> u64 {
        match self {
            Layout::Single { checkpoint } => *checkpoint,
            Layout::Segmented { segments } => segments.iter().map(|s| s.done).sum(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorInfo {
    pub kind: ErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub id: String,
    /// Original URL as entered. Stored so the download can be resumed later.
    pub url: String,
    pub dest_dir: PathBuf,
    pub file_name: String,
    /// Partial file name inside `dest_dir`.
    pub part_name: String,
    pub status: Status,
    pub total_size: Option<u64>,
    #[serde(default)]
    pub validators: Validators,
    /// The server confirmed byte-range support with a valid 206 response.
    #[serde(default)]
    pub resumable: bool,
    /// The server's range responses were wrong once; never use ranges again.
    #[serde(default)]
    pub ranges_unreliable: bool,
    pub layout: Layout,
    pub error: Option<ErrorInfo>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub download_dir: PathBuf,
    /// How many downloads may run at the same time.
    pub max_concurrent: u8,
    /// Maximum connections for one download (1 disables segmentation).
    pub connections_per_download: u8,
    /// Restart interrupted downloads automatically when the app starts.
    pub auto_resume: bool,
    /// Retry transient failures (dropped connections, timeouts, 5xx) automatically.
    pub retry_automatically: bool,
    /// Automatic retries before a download is marked failed (1–10).
    pub retry_attempts: u8,
    /// Ask for a folder each time a download is added (used by the UI).
    pub ask_each_time: bool,
    /// Keep completed downloads in the list across restarts.
    pub keep_history: bool,
    /// Show a system notification when a download finishes.
    pub notify_on_finish: bool,
    pub theme: Theme,
    pub density: Density,
    /// Torrent download speed limit in KiB/s (0 = unlimited).
    pub torrent_download_limit_kib: u32,
    /// Torrent upload speed limit in KiB/s (0 = unlimited).
    pub torrent_upload_limit_kib: u32,
    /// Torrents downloading at the same time; others wait. Seeding doesn't count.
    pub max_active_torrents: u8,
    /// Stop seeding once uploaded / size reaches `seed_ratio_percent` / 100.
    pub seed_ratio_enabled: bool,
    pub seed_ratio_percent: u32,
    /// Stop seeding after this much seeding time.
    pub seed_time_enabled: bool,
    pub seed_time_minutes: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    /// Follow the Windows app theme.
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Density {
    #[default]
    Comfortable,
    Compact,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: dirs::download_dir()
                .or_else(dirs::home_dir)
                .unwrap_or_else(|| PathBuf::from(".")),
            max_concurrent: 4,
            connections_per_download: 4,
            auto_resume: true,
            retry_automatically: true,
            retry_attempts: 5,
            ask_each_time: false,
            keep_history: true,
            notify_on_finish: true,
            theme: Theme::System,
            density: Density::Comfortable,
            torrent_download_limit_kib: 0,
            torrent_upload_limit_kib: 0,
            max_active_torrents: 3,
            seed_ratio_enabled: true,
            seed_ratio_percent: 100,
            seed_time_enabled: false,
            seed_time_minutes: 60,
        }
    }
}

impl Settings {
    pub const MAX_CONCURRENT: u8 = 10;
    pub const MAX_CONNECTIONS: u8 = 8;
    pub const MAX_RETRY_ATTEMPTS: u8 = 10;
    pub const MAX_ACTIVE_TORRENTS: u8 = 20;

    pub(crate) fn normalized(mut self) -> Self {
        self.max_concurrent = self.max_concurrent.clamp(1, Self::MAX_CONCURRENT);
        self.connections_per_download = self
            .connections_per_download
            .clamp(1, Self::MAX_CONNECTIONS);
        self.retry_attempts = self.retry_attempts.clamp(1, Self::MAX_RETRY_ATTEMPTS);
        self.max_active_torrents = self.max_active_torrents.clamp(1, Self::MAX_ACTIVE_TORRENTS);
        self.seed_ratio_percent = self.seed_ratio_percent.clamp(10, 10_000);
        self.seed_time_minutes = self.seed_time_minutes.clamp(1, 525_600);
        self.torrent_download_limit_kib = self.torrent_download_limit_kib.min(4_000_000);
        self.torrent_upload_limit_kib = self.torrent_upload_limit_kib.min(4_000_000);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DownloadKind {
    Direct,
    Torrent,
}

/// What a torrent is doing, in more detail than [`Status`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TorrentState {
    /// Resolving a magnet link into the torrent's file list.
    Fetching,
    /// Waiting for a free torrent slot.
    Queued,
    /// Verifying data already on disk.
    Checking,
    /// Looking for peers; nothing received yet.
    Connecting,
    Downloading,
    /// No data has arrived for a while: waiting for peers.
    Stalled,
    Paused,
    /// Complete and uploading to other peers.
    Seeding,
    /// Complete; not seeding.
    Stopped,
    Error,
}

/// Torrent fields of a [`DownloadView`]; cheap enough to send every tick.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentSummary {
    pub state: TorrentState,
    pub peers_connected: u32,
    pub peers_known: u32,
    /// Uploaded in total, across restarts.
    pub uploaded: u64,
    /// uploaded / size of the selected files.
    pub ratio: f64,
    pub file_count: u32,
    pub selected_count: u32,
    /// Seeding stopped because a seeding limit was reached.
    pub seed_limit_reached: bool,
    pub info_hash: String,
}

/// Snapshot of a download for display.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadView {
    pub id: String,
    pub kind: DownloadKind,
    /// Scheme, host and path only: no credentials, query or fragment.
    pub display_url: String,
    /// Number of query parameters hidden from `display_url`.
    pub hidden_params: u32,
    pub host: String,
    pub file_name: String,
    pub dest_dir: PathBuf,
    pub status: Status,
    pub phase: Option<Phase>,
    pub total_size: Option<u64>,
    pub downloaded: u64,
    pub speed: Option<u64>,
    pub eta_secs: Option<u64>,
    pub resumable: bool,
    /// Pausing keeps progress. False when the server can't resume and
    /// bytes have already been downloaded.
    pub can_pause: bool,
    pub connections: u32,
    /// 1-based position among queued downloads (start order).
    pub queue_position: Option<u32>,
    pub retry_in_secs: Option<u64>,
    /// Which automatic retry is pending, while phase is `retrying`.
    pub retry_attempt: Option<u32>,
    /// Automatic retries allowed (0 when automatic retry is off).
    pub retry_limit: u32,
    pub error: Option<ErrorInfo>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    /// Bytes/s sent to other peers (torrents only).
    pub upload_speed: Option<u64>,
    pub torrent: Option<TorrentSummary>,
}

/// One file inside a torrent.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFile {
    pub index: usize,
    /// Path inside the torrent, with `/` separators.
    pub path: String,
    pub size: u64,
}

/// A torrent's contents, shown before it is added.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentPreview {
    /// Pass back in [`AddTorrentRequest::probe_id`] to add without fetching again.
    pub probe_id: String,
    pub name: String,
    pub info_hash: String,
    pub total_size: u64,
    pub files: Vec<TorrentFile>,
    pub trackers: Vec<String>,
    /// Folder name or file name the torrent will create in the destination.
    pub save_as: String,
}

/// Where to get a torrent from.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "value")]
pub enum TorrentSource {
    Magnet(String),
    File(PathBuf),
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTorrentRequest {
    /// A preview from `probe_torrent`; the file list is already known.
    pub probe_id: Option<String>,
    /// A magnet link to fetch in the background ("start automatically after
    /// fetching details"); all files are downloaded.
    pub magnet: Option<String>,
    pub dest_dir: Option<PathBuf>,
    /// File indexes to download; `None` means all.
    pub selected: Option<Vec<usize>>,
    #[serde(default)]
    pub start_paused: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFileView {
    pub index: usize,
    pub path: String,
    pub size: u64,
    /// Bytes of this file already downloaded and verified.
    pub have: u64,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentDetails {
    pub files: Vec<TorrentFileView>,
    pub peers_connected: u32,
    pub peers_connecting: u32,
    pub peers_known: u32,
    /// Bytes of the selected files downloaded and verified.
    pub downloaded: u64,
    pub uploaded: u64,
    pub ratio: f64,
    pub trackers: Vec<String>,
    pub seeding: bool,
    pub seeded_secs: u64,
    /// Active seeding limits, as configured in Settings.
    pub ratio_limit: Option<f64>,
    pub time_limit_minutes: Option<u32>,
    pub seed_limit_reached: bool,
    pub info_hash: String,
    pub save_path: PathBuf,
}

/// What "Delete downloaded files" would remove, for the confirmation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteScope {
    pub file_count: u32,
    pub total_bytes: u64,
    /// The folder the files are in.
    pub folder: PathBuf,
    /// Up to a few example paths, relative to `folder`.
    pub examples: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddRequest {
    pub url: String,
    pub dest_dir: Option<PathBuf>,
    pub file_name: Option<String>,
    #[serde(default)]
    pub start_paused: bool,
    /// Put this download first in line instead of last.
    #[serde(default)]
    pub queue_first: bool,
}

/// The whole list plus queue-wide state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub downloads: Vec<DownloadView>,
    /// "Pause all" is in effect: queued downloads wait until "Resume all".
    pub queue_held: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QueueMove {
    Top,
    Up,
    Down,
}

/// What the server told us about a URL before adding it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    /// Sanitized and unique in the destination folder.
    pub suggested_name: String,
    /// A file (or download) already uses the server's name, so
    /// `suggested_name` has a number added.
    pub name_clash: bool,
    pub total_size: Option<u64>,
    pub content_type: Option<String>,
    /// Range support was advertised; resuming will still be verified.
    pub resumable: bool,
    pub redirected: bool,
}
