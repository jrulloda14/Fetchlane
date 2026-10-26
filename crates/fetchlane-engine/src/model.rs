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
    pub theme: Theme,
    pub density: Density,
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
            theme: Theme::System,
            density: Density::Comfortable,
        }
    }
}

impl Settings {
    pub const MAX_CONCURRENT: u8 = 10;
    pub const MAX_CONNECTIONS: u8 = 8;
    pub const MAX_RETRY_ATTEMPTS: u8 = 10;

    pub(crate) fn normalized(mut self) -> Self {
        self.max_concurrent = self.max_concurrent.clamp(1, Self::MAX_CONCURRENT);
        self.connections_per_download = self
            .connections_per_download
            .clamp(1, Self::MAX_CONNECTIONS);
        self.retry_attempts = self.retry_attempts.clamp(1, Self::MAX_RETRY_ATTEMPTS);
        self
    }
}

/// Snapshot of a download for display.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadView {
    pub id: String,
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
    pub suggested_name: String,
    pub total_size: Option<u64>,
    pub content_type: Option<String>,
    /// Range support was advertised; resuming will still be verified.
    pub resumable: bool,
    pub redirected: bool,
}
