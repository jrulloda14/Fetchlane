//! Download list, queue scheduling and lifecycle commands.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use reqwest::header;
use tokio::runtime::Handle;
use tokio::sync::{broadcast, Notify};
use tokio_util::sync::CancellationToken;

use crate::error::{DownloadError, ErrorKind};
use crate::model::{
    AddRequest, DownloadRecord, DownloadView, ErrorInfo, Layout, Phase, ProbeResult, QueueMove,
    Settings, Snapshot, Status,
};
use crate::redact::{display_url, host_of, query_param_count, redact_url};
use crate::speed::SpeedMeter;
use crate::store::Store;
use crate::worker::RunOptions;
use crate::{filename, http, worker, EngineConfig};

/// Why a running worker was asked to stop. Higher variants win when several
/// requests race (e.g. pause then cancel).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum StopReason {
    Pause,
    Shutdown,
    Restart,
    Cancel,
    Remove,
}

/// How eagerly a queued download should start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StartMode {
    /// Waits for a free slot and for the queue not to be on hold.
    Normal,
    /// The user acted on this download directly: ignore "Pause all".
    IgnoreHold,
    /// "Start now": start even if every slot is busy.
    Now,
}

/// Shared between the engine and the single worker of one download.
pub(crate) struct Live {
    pub cancel: CancellationToken,
    reason: Mutex<Option<StopReason>>,
    /// Bytes written so far (including not-yet-checkpointed ones).
    pub bytes: AtomicU64,
    pub connections: AtomicU32,
    phase: AtomicU8,
    retry_at: Mutex<Option<Instant>>,
    /// Which automatic retry is pending (0 when not retrying).
    pub retry_attempt: AtomicU32,
    /// Ends a retry wait early ("Retry now").
    pub retry_wake: Notify,
}

impl Live {
    fn new() -> Self {
        Self {
            cancel: CancellationToken::new(),
            reason: Mutex::new(None),
            bytes: AtomicU64::new(0),
            connections: AtomicU32::new(0),
            phase: AtomicU8::new(Phase::Connecting as u8),
            retry_at: Mutex::new(None),
            retry_attempt: AtomicU32::new(0),
            retry_wake: Notify::new(),
        }
    }

    fn request_stop(&self, reason: StopReason) {
        {
            let mut current = lock(&self.reason);
            *current = Some(current.map_or(reason, |r| r.max(reason)));
        }
        self.set_phase(Phase::Stopping);
        self.cancel.cancel();
    }

    fn take_reason(&self) -> Option<StopReason> {
        lock(&self.reason).take()
    }

    pub fn set_phase(&self, phase: Phase) {
        // Once stopping, stay stopping so the UI doesn't flicker.
        if self.cancel.is_cancelled() && phase != Phase::Stopping {
            return;
        }
        self.phase.store(phase as u8, Ordering::Relaxed);
    }

    fn phase(&self) -> Phase {
        match self.phase.load(Ordering::Relaxed) {
            x if x == Phase::Connecting as u8 => Phase::Connecting,
            x if x == Phase::Transferring as u8 => Phase::Transferring,
            x if x == Phase::Retrying as u8 => Phase::Retrying,
            x if x == Phase::Finalizing as u8 => Phase::Finalizing,
            _ => Phase::Stopping,
        }
    }

    pub fn set_retry_at(&self, at: Option<Instant>) {
        *lock(&self.retry_at) = at;
    }
}

pub(crate) struct Entry {
    pub rec: DownloadRecord,
    live: Option<Arc<Live>>,
    speed: SpeedMeter,
    /// Removed by the user while its worker is still shutting down.
    hidden: bool,
    start: StartMode,
}

impl Entry {
    fn new(rec: DownloadRecord) -> Self {
        Self {
            rec,
            live: None,
            speed: SpeedMeter::default(),
            hidden: false,
            start: StartMode::Normal,
        }
    }

    fn live_bytes(&self) -> u64 {
        self.live
            .as_ref()
            .map_or(0, |l| l.bytes.load(Ordering::Relaxed))
    }

    /// Pausing must never lose data: a download that has bytes but can't be
    /// resumed can't be paused.
    fn can_pause(&self) -> bool {
        match self.rec.status {
            Status::Queued => true,
            Status::Downloading => {
                (self.rec.resumable && !self.rec.ranges_unreliable) || self.live_bytes() == 0
            }
            _ => false,
        }
    }

    fn needs_restart(&self) -> bool {
        self.rec.status == Status::Failed
            && self
                .rec
                .error
                .as_ref()
                .is_some_and(|e| e.kind == ErrorKind::CannotResume)
    }
}

/// Forget the partial data and everything learned about the resource.
fn reset_progress(rec: &mut DownloadRecord) {
    rec.layout = Layout::fresh();
    rec.total_size = None;
    rec.validators = Default::default();
    rec.resumable = false;
    rec.ranges_unreliable = false;
}

fn cannot_resume_error() -> DownloadError {
    DownloadError::new(
        ErrorKind::CannotResume,
        "The server can't continue this download. Restart it to download it again.",
    )
}

pub(crate) struct State {
    settings: Settings,
    /// Order is the queue order: queued downloads start front to back.
    entries: Vec<Entry>,
    /// "Pause all" is in effect.
    queue_held: bool,
}

impl State {
    fn index(&self, id: &str) -> Option<usize> {
        self.entries
            .iter()
            .position(|e| e.rec.id == id && !e.hidden)
    }

    fn entry_mut(&mut self, id: &str) -> Result<&mut Entry, DownloadError> {
        let idx = self.index(id).ok_or_else(not_found)?;
        Ok(&mut self.entries[idx])
    }

    fn queued_indices(&self) -> Vec<usize> {
        (0..self.entries.len())
            .filter(|&i| !self.entries[i].hidden && self.entries[i].rec.status == Status::Queued)
            .collect()
    }

    fn retry_limit(&self) -> u32 {
        if self.settings.retry_automatically {
            self.settings.retry_attempts as u32
        } else {
            0
        }
    }

    fn snapshot(&self) -> Snapshot {
        let retry_limit = self.retry_limit();
        let mut position = 0;
        let downloads = self
            .entries
            .iter()
            .filter(|e| !e.hidden)
            .map(|e| {
                let pos = (e.rec.status == Status::Queued).then(|| {
                    position += 1;
                    position
                });
                view(e, pos, retry_limit)
            })
            .collect();
        Snapshot {
            downloads,
            queue_held: self.queue_held,
        }
    }
}

pub(crate) enum Outcome {
    Completed { file_name: String, size: u64 },
    Stopped,
    Failed(DownloadError),
}

pub(crate) struct Inner {
    pub cfg: EngineConfig,
    pub client: reqwest::Client,
    store: Store,
    state: Mutex<State>,
    changed: broadcast::Sender<()>,
    persist_wake: Notify,
    workers_done: Notify,
    shutting_down: AtomicBool,
    closed: AtomicBool,
    rt: Handle,
    /// Running worker tasks per download, and the highest count ever seen.
    /// The scheduler guarantees at most one; this checks that it does.
    running: Mutex<(std::collections::HashMap<String, usize>, usize)>,
}

/// Handle to the download engine. Cheap to clone.
#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn not_found() -> DownloadError {
    DownloadError::invalid("That download no longer exists.")
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn part_path(rec: &DownloadRecord) -> PathBuf {
    rec.dest_dir.join(&rec.part_name)
}

fn remove_part(path: &Path) {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => tracing::warn!("couldn't delete partial file: {e}"),
    }
}

/// Make a loaded record consistent with what is actually on disk.
fn reconcile_on_load(rec: &mut DownloadRecord, auto_resume: bool) {
    if matches!(rec.status, Status::Downloading | Status::Queued) {
        rec.status = if auto_resume {
            Status::Queued
        } else {
            Status::Paused
        };
    }
    if matches!(rec.status, Status::Completed | Status::Canceled) {
        return;
    }
    if !rec.dest_dir.is_dir() {
        // Drive may be unplugged; keep the record as-is until it returns.
        return;
    }
    let part = part_path(rec);
    let len = match fs::metadata(&part) {
        Ok(m) => m.len(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            rec.layout = Layout::fresh();
            return;
        }
        Err(_) => return,
    };
    match &mut rec.layout {
        Layout::Single { checkpoint } => {
            if len > *checkpoint {
                // Bytes past the last checkpoint may not have reached the disk
                // intact before a crash. Drop them.
                let truncated = fs::OpenOptions::new()
                    .write(true)
                    .open(&part)
                    .and_then(|f| f.set_len(*checkpoint));
                if truncated.is_err() {
                    rec.layout = Layout::fresh();
                }
            } else if len < *checkpoint {
                *checkpoint = len;
            }
        }
        Layout::Segmented { segments } => {
            let expected = segments.last().map(|s| s.end);
            if expected != Some(len) || rec.total_size != expected {
                rec.layout = Layout::fresh();
            }
        }
    }
}

impl Engine {
    /// Load persisted state from `data_dir` and start the queue. Must be
    /// called from within a Tokio runtime.
    pub async fn open(
        data_dir: impl Into<PathBuf>,
        cfg: EngineConfig,
    ) -> Result<Self, DownloadError> {
        let rt = Handle::try_current()
            .map_err(|_| DownloadError::internal("No async runtime available."))?;
        let store = Store::new(data_dir.into()).map_err(|e| DownloadError::from_io(&e))?;
        let settings = store.load_settings().normalized();
        let (mut records, queue_held) = store.load_downloads();
        for rec in &mut records {
            reconcile_on_load(rec, settings.auto_resume);
        }
        let client = http::build_client(&cfg)?;
        let (changed, _) = broadcast::channel(16);
        let entries = records.into_iter().map(Entry::new).collect();
        let inner = Arc::new(Inner {
            cfg,
            client,
            store,
            state: Mutex::new(State {
                settings,
                entries,
                queue_held,
            }),
            changed,
            persist_wake: Notify::new(),
            workers_done: Notify::new(),
            shutting_down: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            rt,
            running: Mutex::new(Default::default()),
        });
        inner.persist_now();
        inner.spawn_background();
        inner.schedule();
        Ok(Self { inner })
    }

    /// Fires whenever the list or any progress changes.
    pub fn subscribe(&self) -> broadcast::Receiver<()> {
        self.inner.changed.subscribe()
    }

    /// Every download (in queue order) plus queue-wide state.
    pub fn snapshot(&self) -> Snapshot {
        lock(&self.inner.state).snapshot()
    }

    pub fn list(&self) -> Vec<DownloadView> {
        self.snapshot().downloads
    }

    pub fn get(&self, id: &str) -> Option<DownloadView> {
        self.list().into_iter().find(|v| v.id == id)
    }

    /// Full source URL, including credentials and query, for "Copy link"
    /// and for revealing hidden parameters.
    pub fn source_url(&self, id: &str) -> Result<String, DownloadError> {
        let st = lock(&self.inner.state);
        Ok(st.entries[st.index(id).ok_or_else(not_found)?]
            .rec
            .url
            .clone())
    }

    /// Free space on the drive holding `path`, if it can be determined.
    pub fn free_space(path: &Path) -> Option<u64> {
        fs4::available_space(path).ok()
    }

    pub fn settings(&self) -> Settings {
        lock(&self.inner.state).settings.clone()
    }

    pub fn update_settings(&self, settings: Settings) -> Result<Settings, DownloadError> {
        let settings = settings.normalized();
        if !settings.download_dir.is_dir() {
            return Err(DownloadError::new(
                ErrorKind::Destination,
                "Choose a download folder that exists.",
            ));
        }
        self.inner
            .store
            .save_settings(&settings)
            .map_err(|e| DownloadError::from_io(&e))?;
        lock(&self.inner.state).settings = settings.clone();
        self.inner.schedule();
        self.inner.notify_changed();
        Ok(settings)
    }

    /// Ask the server about a URL so the user can confirm the name and size.
    pub async fn probe(
        &self,
        raw_url: &str,
        dest_dir: Option<&Path>,
    ) -> Result<ProbeResult, DownloadError> {
        let url = http::parse_url(raw_url)?;
        let inner = &self.inner;
        let timeout = inner.cfg.response_timeout;
        let head = tokio::time::timeout(
            timeout,
            inner
                .client
                .head(url.clone())
                .header(header::ACCEPT_ENCODING, "identity")
                .send(),
        )
        .await;
        let resp = match head {
            Ok(Ok(r)) if r.status().is_success() => r,
            _ => {
                // Some servers reject HEAD; ask for a single byte instead.
                let get = inner
                    .client
                    .get(url.clone())
                    .header(header::RANGE, "bytes=0-0")
                    .header(header::ACCEPT_ENCODING, "identity")
                    .send();
                match tokio::time::timeout(timeout, get).await {
                    Err(_) => return Err(DownloadError::timeout()),
                    Ok(Err(e)) => return Err(DownloadError::from_reqwest(&e)),
                    Ok(Ok(r)) => r,
                }
            }
        };
        let status = resp.status().as_u16();
        let headers = resp.headers();
        if !(200..300).contains(&status) {
            return Err(DownloadError::from_status(
                status,
                http::retry_after(headers),
            ));
        }
        let total_size = if status == 206 {
            http::content_range(headers).and_then(|c| c.total)
        } else {
            http::content_length(headers)
        };
        let raw_name = http::header_str(headers, header::CONTENT_DISPOSITION)
            .and_then(|v| filename::from_content_disposition(&v))
            .or_else(|| filename::from_url(resp.url()))
            .or_else(|| filename::from_url(&url))
            .unwrap_or_default();
        let content_type = http::header_str(headers, header::CONTENT_TYPE)
            .map(|v| v.split(';').next().unwrap_or("").trim().to_string())
            .filter(|v| !v.is_empty());
        let resumable = status == 206 || http::accepts_byte_ranges(headers);
        let redirected = resp.url() != &url;
        let dir = dest_dir
            .map(Path::to_path_buf)
            .unwrap_or_else(|| self.settings().download_dir);
        let suggested_name = {
            let st = lock(&inner.state);
            unique_name(&st, &dir, &filename::sanitize(&raw_name))
        };
        Ok(ProbeResult {
            suggested_name,
            total_size,
            content_type,
            resumable,
            redirected,
        })
    }

    pub fn add(&self, req: AddRequest) -> Result<DownloadView, DownloadError> {
        let url = http::parse_url(&req.url)?;
        let mut st = lock(&self.inner.state);
        let dest_dir = req
            .dest_dir
            .unwrap_or_else(|| st.settings.download_dir.clone());
        if !dest_dir.is_dir() {
            return Err(DownloadError::destination_unavailable());
        }
        let name = match req
            .file_name
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty())
        {
            Some(n) => filename::validate_user_name(n)?,
            None => filename::sanitize(&filename::from_url(&url).unwrap_or_default()),
        };
        let name = unique_name(&st, &dest_dir, &name);
        let id = uuid::Uuid::new_v4().simple().to_string();
        let rec = DownloadRecord {
            part_name: format!("{name}.{}.fetchlane-part", &id[..8]),
            id,
            url: url.to_string(),
            dest_dir,
            file_name: name,
            status: if req.start_paused {
                Status::Paused
            } else {
                Status::Queued
            },
            total_size: None,
            validators: Default::default(),
            resumable: false,
            ranges_unreliable: false,
            layout: Layout::fresh(),
            error: None,
            created_at: now_ms(),
            completed_at: None,
        };
        tracing::info!(id = %rec.id, url = %redact_url(&rec.url), "download added");
        let id = rec.id.clone();
        let entry = Entry::new(rec);
        match st.queued_indices().first() {
            Some(&first) if req.queue_first => st.entries.insert(first, entry),
            _ => st.entries.push(entry),
        }
        drop(st);
        self.inner.persist_now();
        self.inner.schedule();
        self.inner.notify_changed();
        self.get(&id).ok_or_else(not_found)
    }

    pub fn pause(&self, id: &str) -> Result<(), DownloadError> {
        {
            let mut st = lock(&self.inner.state);
            let e = st.entry_mut(id)?;
            if e.rec.status == Status::Downloading && !e.can_pause() {
                return Err(DownloadError::new(
                    ErrorKind::CannotResume,
                    "This download can't be paused because the server can't resume it. Pausing would lose the progress.",
                ));
            }
            match e.rec.status {
                Status::Queued => e.rec.status = Status::Paused,
                Status::Downloading => {
                    e.rec.status = Status::Paused;
                    if let Some(live) = &e.live {
                        live.request_stop(StopReason::Pause);
                    }
                }
                _ => return Ok(()),
            }
        }
        self.inner.persist_soon();
        self.inner.notify_changed();
        Ok(())
    }

    /// Resume a paused download, retry a failed one, or restart a canceled one.
    pub fn resume(&self, id: &str) -> Result<(), DownloadError> {
        {
            let mut st = lock(&self.inner.state);
            let e = st.entry_mut(id)?;
            if e.needs_restart() {
                return Err(cannot_resume_error());
            }
            match e.rec.status {
                Status::Paused | Status::Failed | Status::Canceled => {
                    e.rec.status = Status::Queued;
                    e.rec.error = None;
                    e.start = StartMode::IgnoreHold;
                }
                _ => return Ok(()),
            }
        }
        self.inner.persist_soon();
        self.inner.schedule();
        self.inner.notify_changed();
        Ok(())
    }

    /// "Start now": start immediately, even if every slot is busy.
    pub fn start_now(&self, id: &str) -> Result<(), DownloadError> {
        {
            let mut st = lock(&self.inner.state);
            let idx = st.index(id).ok_or_else(not_found)?;
            let e = &mut st.entries[idx];
            if e.needs_restart() {
                return Err(cannot_resume_error());
            }
            if !matches!(
                e.rec.status,
                Status::Queued | Status::Paused | Status::Failed | Status::Canceled
            ) {
                return Ok(());
            }
            e.rec.status = Status::Queued;
            e.rec.error = None;
            e.start = StartMode::Now;
            // Move it to the front of the queue.
            let entry = st.entries.remove(idx);
            let front = st
                .queued_indices()
                .first()
                .copied()
                .unwrap_or(st.entries.len());
            st.entries.insert(front.min(idx), entry);
        }
        self.inner.persist_now();
        self.inner.schedule();
        self.inner.notify_changed();
        Ok(())
    }

    /// "Retry now": skip the remaining wait before an automatic retry, or
    /// retry a failed download.
    pub fn retry_now(&self, id: &str) -> Result<(), DownloadError> {
        {
            let st = lock(&self.inner.state);
            let e = &st.entries[st.index(id).ok_or_else(not_found)?];
            if let Some(live) = &e.live {
                if live.phase() == Phase::Retrying {
                    live.retry_wake.notify_one();
                }
                return Ok(());
            }
        }
        self.resume(id)
    }

    /// Delete partial data and download again from the beginning.
    pub fn restart(&self, id: &str) -> Result<(), DownloadError> {
        let mut delete = None;
        {
            let mut st = lock(&self.inner.state);
            let e = st.entry_mut(id)?;
            if e.rec.status == Status::Completed {
                return Err(DownloadError::invalid(
                    "This download has already finished.",
                ));
            }
            e.rec.error = None;
            e.start = StartMode::IgnoreHold;
            match &e.live {
                Some(live) => live.request_stop(StopReason::Restart),
                None => {
                    delete = Some(part_path(&e.rec));
                    reset_progress(&mut e.rec);
                }
            }
            e.rec.status = Status::Queued;
        }
        if let Some(p) = delete {
            remove_part(&p);
        }
        self.inner.persist_now();
        self.inner.schedule();
        self.inner.notify_changed();
        Ok(())
    }

    /// Reorder a queued download among the other queued downloads.
    pub fn move_in_queue(&self, id: &str, to: QueueMove) -> Result<(), DownloadError> {
        {
            let mut st = lock(&self.inner.state);
            let idx = st.index(id).ok_or_else(not_found)?;
            if st.entries[idx].rec.status != Status::Queued {
                return Err(DownloadError::invalid(
                    "Only queued downloads can be moved.",
                ));
            }
            let queued = st.queued_indices();
            let pos = queued
                .iter()
                .position(|&i| i == idx)
                .expect("entry is queued");
            let target = match to {
                QueueMove::Top => queued[0],
                QueueMove::Up if pos > 0 => queued[pos - 1],
                QueueMove::Down if pos + 1 < queued.len() => queued[pos + 1],
                _ => return Ok(()),
            };
            let entry = st.entries.remove(idx);
            st.entries.insert(target, entry);
        }
        self.inner.persist_now();
        self.inner.notify_changed();
        Ok(())
    }

    /// Stop a download and delete its partial data. Completed files are kept.
    pub fn cancel(&self, id: &str) -> Result<(), DownloadError> {
        let mut delete = None;
        {
            let mut st = lock(&self.inner.state);
            let e = st.entry_mut(id)?;
            if matches!(e.rec.status, Status::Completed | Status::Canceled) {
                return Ok(());
            }
            e.rec.status = Status::Canceled;
            e.rec.error = None;
            match &e.live {
                Some(live) => live.request_stop(StopReason::Cancel),
                None => {
                    delete = Some(part_path(&e.rec));
                    e.rec.layout = Layout::fresh();
                }
            }
        }
        if let Some(p) = delete {
            remove_part(&p);
        }
        self.inner.persist_now();
        self.inner.notify_changed();
        Ok(())
    }

    /// Remove from the list. Partial data of unfinished downloads is deleted.
    /// A completed file is kept unless `delete_files` is set, in which case
    /// it goes to the Recycle Bin; if that fails the entry stays.
    pub async fn remove(&self, id: &str, delete_files: bool) -> Result<(), DownloadError> {
        let to_trash = {
            let st = lock(&self.inner.state);
            let e = &st.entries[st.index(id).ok_or_else(not_found)?];
            (delete_files && e.rec.status == Status::Completed && e.live.is_none())
                .then(|| e.rec.dest_dir.join(&e.rec.file_name))
                .filter(|p| p.exists())
        };
        if let Some(path) = to_trash {
            let trash = self.inner.cfg.trash.clone();
            tokio::task::spawn_blocking(move || (trash.0)(&path))
                .await
                .map_err(|e| DownloadError::internal(e.to_string()))?
                .map_err(|e| {
                    tracing::warn!("moving to the Recycle Bin failed: {e}");
                    DownloadError::new(
                        ErrorKind::FileSystem,
                        "Couldn't move the file to the Recycle Bin. It may be open in another app.",
                    )
                })?;
        }
        self.remove_entry(id)
    }

    fn remove_entry(&self, id: &str) -> Result<(), DownloadError> {
        let mut delete = None;
        {
            let mut st = lock(&self.inner.state);
            let idx = st.index(id).ok_or_else(not_found)?;
            let e = &mut st.entries[idx];
            match &e.live {
                Some(live) => {
                    e.hidden = true;
                    live.request_stop(StopReason::Remove);
                }
                None => {
                    let e = st.entries.remove(idx);
                    if e.rec.status != Status::Completed {
                        delete = Some(part_path(&e.rec));
                    }
                }
            }
        }
        if let Some(p) = delete {
            remove_part(&p);
        }
        self.inner.persist_now();
        self.inner.notify_changed();
        Ok(())
    }

    /// Remove completed and canceled downloads from the list.
    pub fn clear_finished(&self) {
        lock(&self.inner.state).entries.retain(|e| {
            e.live.is_some() || !matches!(e.rec.status, Status::Completed | Status::Canceled)
        });
        self.inner.persist_now();
        self.inner.notify_changed();
    }

    /// Pause every active download that can resume and hold the queue, so
    /// queued downloads wait until [`Engine::resume_all`]. Downloads that
    /// can't be resumed keep running.
    pub fn pause_all(&self) {
        let ids: Vec<String> = {
            let mut st = lock(&self.inner.state);
            st.queue_held = true;
            st.entries
                .iter()
                .filter(|e| !e.hidden && e.rec.status == Status::Downloading && e.can_pause())
                .map(|e| e.rec.id.clone())
                .collect()
        };
        for id in ids {
            let _ = self.pause(&id);
        }
        self.inner.persist_now();
        self.inner.notify_changed();
    }

    /// Release the queue hold and resume every paused download.
    pub fn resume_all(&self) {
        {
            let mut st = lock(&self.inner.state);
            st.queue_held = false;
            for e in st.entries.iter_mut().filter(|e| !e.hidden) {
                if e.rec.status == Status::Paused {
                    e.rec.status = Status::Queued;
                    e.start = StartMode::Normal;
                }
            }
        }
        self.inner.persist_now();
        self.inner.schedule();
        self.inner.notify_changed();
    }

    /// Path of a completed download's file, if it still exists.
    pub fn completed_file(&self, id: &str) -> Result<PathBuf, DownloadError> {
        let st = lock(&self.inner.state);
        let e = &st.entries[st.index(id).ok_or_else(not_found)?];
        if e.rec.status != Status::Completed {
            return Err(DownloadError::invalid("This download hasn't finished yet."));
        }
        let path = e.rec.dest_dir.join(&e.rec.file_name);
        if !path.is_file() {
            return Err(DownloadError::new(
                ErrorKind::FileSystem,
                "The file was moved or deleted.",
            ));
        }
        Ok(path)
    }

    /// What "show in folder" should reveal: the file if complete, else its folder.
    pub fn reveal_target(&self, id: &str) -> Result<PathBuf, DownloadError> {
        if let Ok(path) = self.completed_file(id) {
            return Ok(path);
        }
        let st = lock(&self.inner.state);
        let e = &st.entries[st.index(id).ok_or_else(not_found)?];
        if e.rec.dest_dir.is_dir() {
            Ok(e.rec.dest_dir.clone())
        } else {
            Err(DownloadError::destination_unavailable())
        }
    }

    /// Stop all workers (keeping their progress) and write final state.
    pub async fn shutdown(&self) {
        let inner = &self.inner;
        if inner.shutting_down.swap(true, Ordering::SeqCst) {
            return;
        }
        {
            let st = lock(&inner.state);
            for live in st.entries.iter().filter_map(|e| e.live.as_ref()) {
                live.request_stop(StopReason::Shutdown);
            }
        }
        let deadline = tokio::time::Instant::now() + inner.cfg.shutdown_grace;
        loop {
            let notified = inner.workers_done.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if !lock(&inner.state).entries.iter().any(|e| e.live.is_some()) {
                break;
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                tracing::warn!(
                    "some downloads didn't stop in time; their last checkpoint will be used"
                );
                break;
            }
        }
        inner.persist_now();
        inner.closed.store(true, Ordering::SeqCst);
        inner.persist_wake.notify_one();
    }

    /// Highest number of workers ever running at once for a single download.
    /// Always 1 (or 0) unless there is a bug; exposed for tests.
    #[doc(hidden)]
    pub fn peak_workers_per_download(&self) -> usize {
        lock(&self.inner.running).1
    }

    /// Location of the persisted download list (for diagnostics and tests).
    pub fn state_file(&self) -> PathBuf {
        self.inner.store.downloads_path()
    }
}

fn view(e: &Entry, queue_position: Option<u32>, retry_limit: u32) -> DownloadView {
    let rec = &e.rec;
    let live = e.live.as_ref();
    let downloaded = match (rec.status, live) {
        (_, Some(l)) => l.bytes.load(Ordering::Relaxed),
        (Status::Completed, None) => rec.total_size.unwrap_or_else(|| rec.layout.downloaded()),
        _ => rec.layout.downloaded(),
    };
    let speed = live.and_then(|_| e.speed.rate());
    let eta_secs = match (rec.total_size, speed) {
        (Some(total), Some(s)) if s > 0 && total >= downloaded => {
            Some((total - downloaded).div_ceil(s))
        }
        _ => None,
    };
    let retry_in_secs = live.and_then(|l| *lock(&l.retry_at)).map(|at| {
        at.saturating_duration_since(Instant::now())
            .as_secs_f64()
            .ceil() as u64
    });
    let retry_attempt = live
        .filter(|l| l.phase() == Phase::Retrying)
        .map(|l| l.retry_attempt.load(Ordering::Relaxed))
        .filter(|&n| n > 0);
    DownloadView {
        id: rec.id.clone(),
        display_url: display_url(&rec.url),
        hidden_params: query_param_count(&rec.url),
        host: host_of(&rec.url),
        file_name: rec.file_name.clone(),
        dest_dir: rec.dest_dir.clone(),
        status: rec.status,
        phase: live.map(|l| l.phase()),
        total_size: rec.total_size,
        downloaded,
        speed,
        eta_secs,
        resumable: rec.resumable && !rec.ranges_unreliable,
        can_pause: e.can_pause(),
        connections: live.map_or(0, |l| l.connections.load(Ordering::Relaxed)),
        queue_position,
        retry_in_secs,
        retry_attempt,
        retry_limit,
        error: rec.error.clone(),
        created_at: rec.created_at,
        completed_at: rec.completed_at,
    }
}

/// First name not used by an existing file or another unfinished download.
fn unique_name(st: &State, dir: &Path, name: &str) -> String {
    filename::unique(name, |candidate| {
        dir.join(candidate).exists()
            || st.entries.iter().any(|e| {
                !matches!(e.rec.status, Status::Completed | Status::Canceled)
                    && e.rec.dest_dir == dir
                    && e.rec.file_name.eq_ignore_ascii_case(candidate)
            })
    })
}

impl Inner {
    pub fn notify_changed(&self) {
        let _ = self.changed.send(());
    }

    pub fn persist_soon(&self) {
        self.persist_wake.notify_one();
    }

    pub fn persist_now(&self) {
        if self.closed.load(Ordering::SeqCst) {
            return;
        }
        let result = self.store.save_downloads_with(|| {
            let st = lock(&self.state);
            let keep_completed = st.settings.keep_history;
            let records = st
                .entries
                .iter()
                .filter(|e| !e.hidden)
                .filter(|e| keep_completed || e.rec.status != Status::Completed)
                .map(|e| e.rec.clone())
                .collect();
            (records, st.queue_held)
        });
        if let Err(e) = result {
            tracing::error!("couldn't save the download list: {e}");
        }
    }

    /// Apply a change from a worker to its record, if it still exists.
    pub fn update_record(&self, id: &str, f: impl FnOnce(&mut DownloadRecord)) {
        let mut st = lock(&self.state);
        if let Some(e) = st.entries.iter_mut().find(|e| e.rec.id == id) {
            f(&mut e.rec);
        }
    }

    fn spawn_background(self: &Arc<Self>) {
        let weak = Arc::downgrade(self);
        self.rt.spawn(async move {
            loop {
                let Some(inner) = weak.upgrade() else { break };
                if inner.closed.load(Ordering::SeqCst) {
                    break;
                }
                let tick = inner.cfg.tick_interval;
                inner.tick();
                drop(inner);
                tokio::time::sleep(tick).await;
            }
        });
        let inner = self.clone();
        self.rt.spawn(async move {
            loop {
                inner.persist_wake.notified().await;
                if inner.closed.load(Ordering::SeqCst) {
                    break;
                }
                tokio::time::sleep(inner.cfg.persist_debounce).await;
                inner.persist_now();
            }
        });
    }

    fn tick(&self) {
        let now = Instant::now();
        let mut any_live = false;
        {
            let mut st = lock(&self.state);
            for e in st.entries.iter_mut() {
                if let Some(live) = &e.live {
                    e.speed.sample(now, live.bytes.load(Ordering::Relaxed));
                    any_live = true;
                }
            }
        }
        if any_live {
            self.notify_changed();
        }
    }

    /// Start queued downloads while there are free slots.
    fn schedule(self: &Arc<Self>) {
        if self.shutting_down.load(Ordering::SeqCst) {
            return;
        }
        let mut to_start = Vec::new();
        {
            let mut st = lock(&self.state);
            let max = st.settings.max_concurrent as usize;
            let held = st.queue_held;
            let opts = RunOptions {
                connections: st.settings.connections_per_download,
                retry_limit: st.retry_limit(),
            };
            let mut active = st.entries.iter().filter(|e| e.live.is_some()).count();
            for e in st.entries.iter_mut() {
                // A download whose previous worker is still stopping waits
                // here; it is scheduled again when that worker exits.
                if e.rec.status != Status::Queued || e.live.is_some() || e.hidden {
                    continue;
                }
                let start = match e.start {
                    StartMode::Now => true,
                    StartMode::IgnoreHold => active < max,
                    StartMode::Normal => !held && active < max,
                };
                if start {
                    let live = Arc::new(Live::new());
                    e.live = Some(live.clone());
                    e.rec.status = Status::Downloading;
                    e.rec.error = None;
                    e.start = StartMode::Normal;
                    e.speed.reset();
                    to_start.push((e.rec.clone(), live, opts));
                    active += 1;
                }
            }
        }
        if to_start.is_empty() {
            return;
        }
        for (rec, live, opts) in to_start {
            let inner = self.clone();
            let id = rec.id.clone();
            self.rt.spawn(async move {
                inner.track_worker(&id, true);
                let task = tokio::spawn(worker::run(inner.clone(), rec, live.clone(), opts));
                let outcome = match task.await {
                    Ok(o) => o,
                    Err(e) => Outcome::Failed(DownloadError::internal(format!(
                        "The download stopped unexpectedly: {e}"
                    ))),
                };
                inner.track_worker(&id, false);
                inner.on_exit(&id, &live, outcome);
            });
        }
        self.persist_soon();
        self.notify_changed();
    }

    fn track_worker(&self, id: &str, started: bool) {
        let mut guard = lock(&self.running);
        let (map, peak) = &mut *guard;
        let n = map.entry(id.to_string()).or_default();
        if started {
            *n += 1;
            if *n > 1 {
                tracing::error!(id, "more than one worker running for a download");
            }
            *peak = (*peak).max(*n);
        } else {
            *n -= 1;
            if *n == 0 {
                map.remove(id);
            }
        }
    }

    /// Called exactly once per worker after it has stopped touching files.
    fn on_exit(self: &Arc<Self>, id: &str, live: &Arc<Live>, outcome: Outcome) {
        let reason = live.take_reason();
        let mut delete = None;
        {
            let mut st = lock(&self.state);
            if let Some(idx) = st.entries.iter().position(|e| e.rec.id == id) {
                let e = &mut st.entries[idx];
                if !e.live.as_ref().is_some_and(|l| Arc::ptr_eq(l, live)) {
                    tracing::error!(id, "worker exit for a download it doesn't own");
                } else {
                    e.live = None;
                    e.speed.reset();
                    let mut drop_entry = e.hidden;
                    match (outcome, reason) {
                        (Outcome::Completed { file_name, size }, _) => {
                            tracing::info!(id, "download completed");
                            e.rec.file_name = file_name;
                            e.rec.status = Status::Completed;
                            e.rec.total_size = Some(size);
                            e.rec.layout = Layout::Single { checkpoint: size };
                            e.rec.error = None;
                            e.rec.completed_at = Some(now_ms());
                        }
                        (_, Some(StopReason::Remove)) => {
                            delete = Some(part_path(&e.rec));
                            drop_entry = true;
                        }
                        (_, Some(StopReason::Cancel)) => {
                            delete = Some(part_path(&e.rec));
                            e.rec.layout = Layout::fresh();
                            if e.rec.status != Status::Queued {
                                e.rec.status = Status::Canceled;
                            }
                        }
                        (_, Some(StopReason::Restart)) => {
                            delete = Some(part_path(&e.rec));
                            reset_progress(&mut e.rec);
                            if e.rec.status == Status::Downloading {
                                e.rec.status = Status::Queued;
                            }
                        }
                        (_, Some(StopReason::Shutdown)) => e.rec.status = Status::Queued,
                        (_, Some(StopReason::Pause)) | (Outcome::Stopped, None) => {
                            if e.rec.status != Status::Queued {
                                e.rec.status = Status::Paused;
                            }
                        }
                        (Outcome::Failed(err), None) => {
                            tracing::warn!(id, kind = ?err.kind, "download failed: {}", err.message);
                            e.rec.status = Status::Failed;
                            e.rec.error = Some(ErrorInfo {
                                kind: err.kind,
                                message: err.message,
                            });
                        }
                    }
                    if drop_entry {
                        st.entries.remove(idx);
                    }
                }
            }
        }
        if let Some(p) = delete {
            remove_part(&p);
        }
        self.persist_now();
        self.notify_changed();
        self.workers_done.notify_waiters();
        self.schedule();
    }
}

impl Drop for Inner {
    fn drop(&mut self) {
        self.closed.store(true, Ordering::SeqCst);
    }
}
