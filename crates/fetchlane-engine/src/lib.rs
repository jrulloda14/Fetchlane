//! Fetchlane download engine.
//!
//! This crate has no UI dependencies. The desktop app (or any other front
//! end) drives it through [`Engine`] and listens for change notifications.
//!
//! Correctness rules the engine follows:
//! - Data streams to a partial file next to the destination; the final name
//!   only appears after the data is complete, flushed, and fsync'd.
//! - Persisted progress only counts bytes that were fsync'd first, so the
//!   saved state never claims more than is on disk.
//! - Resuming requires a validator (strong ETag or Last-Modified) sent via
//!   `If-Range`, plus an exact `Content-Range` match. Anything else restarts
//!   from zero rather than risk mixing two versions of a file.
//! - One worker per download at most; every writer is joined before the
//!   download's state changes.

mod engine;
mod error;
pub mod filename;
mod http;
mod model;
pub mod redact;
mod speed;
mod store;
mod torrent;
mod worker;

use std::fmt;
use std::io;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

pub use engine::Engine;
pub use error::{DownloadError, ErrorKind};
pub use model::{
    AddRequest, AddTorrentRequest, DeleteScope, Density, DownloadKind, DownloadRecord,
    DownloadView, ErrorInfo, Layout, Phase, ProbeResult, QueueMove, Segment, Settings, Snapshot,
    Status, Theme, TorrentDetails, TorrentFile, TorrentFileView, TorrentPreview, TorrentSource,
    TorrentState, TorrentSummary, Validators,
};
pub use torrent::TorrentConfig;

/// Moves a completed file to the Recycle Bin (or the platform's trash).
/// Replaceable so tests never touch the real Recycle Bin.
pub type TrashFn = dyn Fn(&Path) -> io::Result<()> + Send + Sync;

#[derive(Clone)]
pub struct Trasher(pub Arc<TrashFn>);

impl Default for Trasher {
    fn default() -> Self {
        Self(Arc::new(|path| {
            trash::delete(path).map_err(io::Error::other)
        }))
    }
}

impl fmt::Debug for Trasher {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Trasher")
    }
}

/// Tuning knobs that are not user settings. Tests shrink these.
#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub user_agent: String,
    pub connect_timeout: Duration,
    /// Maximum silence while reading a response.
    pub read_timeout: Duration,
    /// Maximum wait for response headers.
    pub response_timeout: Duration,
    pub backoff_base: Duration,
    pub backoff_max: Duration,
    /// Flush + fsync + record progress after this many bytes...
    pub checkpoint_bytes: u64,
    /// ...or after this much time, whichever comes first.
    pub checkpoint_interval: Duration,
    /// Segments are never smaller than this.
    pub min_segment_size: u64,
    /// How often progress/speed notifications are produced.
    pub tick_interval: Duration,
    pub persist_debounce: Duration,
    /// How long shutdown waits for workers to checkpoint.
    pub shutdown_grace: Duration,
    pub trash: Trasher,
    pub torrent: TorrentConfig,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            user_agent: format!("Fetchlane/{}", env!("CARGO_PKG_VERSION")),
            connect_timeout: Duration::from_secs(20),
            read_timeout: Duration::from_secs(30),
            response_timeout: Duration::from_secs(45),
            // 5 s, 15 s, 45 s, then 2 min (as described in Settings).
            backoff_base: Duration::from_secs(5),
            backoff_max: Duration::from_secs(120),
            checkpoint_bytes: 8 * 1024 * 1024,
            checkpoint_interval: Duration::from_secs(2),
            min_segment_size: 2 * 1024 * 1024,
            tick_interval: Duration::from_millis(500),
            persist_debounce: Duration::from_millis(500),
            shutdown_grace: Duration::from_secs(5),
            trash: Trasher::default(),
            torrent: TorrentConfig::default(),
        }
    }
}
