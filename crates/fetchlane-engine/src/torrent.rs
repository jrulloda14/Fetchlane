//! BitTorrent downloads, built on librqbit.
//!
//! Each torrent gets a record persisted in `torrents.json` and a copy of its
//! metainfo in `torrents/<id>.torrent`. On start-up every torrent is added
//! to the librqbit session paused (which verifies the data already on disk)
//! and the scheduler then starts the ones that should run.
//!
//! Safety rules:
//! - A new torrent never writes into a file or folder that already exists:
//!   multi-file torrents get their own folder, and name clashes get " (n)".
//! - File names from torrents are rejected if they aren't safe on Windows
//!   (librqbit already rejects `..` and embedded separators).
//! - Deleting files only touches the torrent's own files, and sends them to
//!   the Recycle Bin.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use librqbit::api::TorrentIdOrHash;
use librqbit::dht::DhtPersistenceConfig;
use librqbit::{
    AddTorrent, AddTorrentOptions, AddTorrentResponse, DhtSessionConfig, ListenerOptions,
    ManagedTorrent, Session, SessionOptions, TorrentStatsState,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, OnceCell};
use tokio_util::sync::CancellationToken;

use crate::error::{DownloadError, ErrorKind};
use crate::model::{
    AddTorrentRequest, DeleteScope, DownloadKind, DownloadView, ErrorInfo, Settings, Status,
    TorrentDetails, TorrentFile, TorrentFileView, TorrentPreview, TorrentSource, TorrentState,
    TorrentSummary,
};
use crate::{filename, store, Trasher};

type Handle = Arc<ManagedTorrent>;

const MAX_TORRENT_FILE_BYTES: u64 = 20 * 1024 * 1024;
const RECORDS_FILE: &str = "torrents.json";

/// Networking knobs for torrents. Tests use loopback-only settings.
#[derive(Debug, Clone)]
pub struct TorrentConfig {
    pub enable_dht: bool,
    pub enable_trackers: bool,
    pub listen_addr: SocketAddr,
    /// Peers to try for every torrent, in addition to DHT and trackers.
    pub extra_peers: Vec<SocketAddr>,
    /// How long without new data before a torrent is shown as stalled.
    pub stall_after: Duration,
    /// Length of a "minute" for seeding time limits (shortened in tests).
    pub minute: Duration,
    pub tick_interval: Duration,
}

impl Default for TorrentConfig {
    fn default() -> Self {
        Self {
            enable_dht: true,
            enable_trackers: true,
            listen_addr: (std::net::Ipv6Addr::UNSPECIFIED, 0).into(),
            extra_peers: Vec::new(),
            stall_after: Duration::from_secs(60),
            minute: Duration::from_secs(60),
            tick_interval: Duration::from_secs(1),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TorrentRecord {
    id: String,
    info_hash: String,
    name: String,
    magnet: Option<String>,
    /// Folder the torrent's files are written under.
    output_folder: PathBuf,
    /// Folder the user chose.
    dest_dir: PathBuf,
    selected: Option<Vec<usize>>,
    has_metadata: bool,
    /// Total size of the selected files.
    total_size: Option<u64>,
    file_count: u32,
    /// The user paused it (or stopped seeding).
    paused: bool,
    stopped_by_limit: bool,
    /// Seeding limits are ignored until the next stop (user resumed seeding).
    #[serde(default)]
    ignore_limits: bool,
    uploaded: u64,
    seeded_secs: u64,
    error: Option<ErrorInfo>,
    created_at: i64,
    completed_at: Option<i64>,
}

#[derive(Default)]
struct Runtime {
    handle: Option<Handle>,
    /// Background magnet fetch in progress.
    fetch: Option<CancellationToken>,
    /// An async operation (add, recheck, remove) owns the torrent right now.
    busy: bool,
    /// "Start now": run even if every torrent slot is busy.
    forced: bool,
    last_uploaded_live: u64,
    last_progress: u64,
    last_progress_at: Option<Instant>,
    live_since: Option<Instant>,
    seed_tick: Option<Instant>,
}

struct Entry {
    rec: TorrentRecord,
    rt: Runtime,
}

struct Probe {
    bytes: bytes::Bytes,
    magnet: Option<String>,
    preview: TorrentPreview,
}

#[derive(Default)]
struct State {
    entries: Vec<Entry>,
    probes: HashMap<String, Probe>,
    fetches: HashMap<String, CancellationToken>,
    settings: Option<Settings>,
}

pub(crate) struct Torrents {
    cfg: TorrentConfig,
    dir: PathBuf,
    state_dir: PathBuf,
    session: OnceCell<Arc<Session>>,
    st: Mutex<State>,
    changed: broadcast::Sender<()>,
    trash: Trasher,
    closed: AtomicBool,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn not_found() -> DownloadError {
    DownloadError::invalid("That download no longer exists.")
}

fn torrent_error(context: &str, e: impl std::fmt::Display) -> DownloadError {
    let text = e.to_string();
    let text = text.lines().next().unwrap_or("").trim();
    DownloadError::new(ErrorKind::Internal, format!("{context}: {text}"))
}

/// Reject names that would be unsafe or unusable on Windows. librqbit
/// already refuses `..` and separators inside a name.
pub(crate) fn check_safe_names<'a>(
    paths: impl IntoIterator<Item = &'a [String]>,
) -> Result<(), DownloadError> {
    let bad = || {
        DownloadError::invalid(
            "This torrent contains file names that aren't safe on Windows, so Fetchlane won't download it.",
        )
    };
    for parts in paths {
        if parts.is_empty() {
            return Err(bad());
        }
        for part in parts {
            if part.is_empty()
                || part.contains([':', '<', '>', '"', '|', '?', '*'])
                || part.chars().any(|c| c.is_control())
            {
                return Err(bad());
            }
            if part.ends_with('.') || part.ends_with(' ') || part == "." {
                return Err(bad());
            }
            if filename::sanitize(part).starts_with('_') && !part.starts_with('_') {
                // sanitize() prefixes reserved device names such as CON or LPT1.
                return Err(bad());
            }
            let p = Path::new(part.as_str());
            if p.components().count() != 1
                || !matches!(p.components().next(), Some(Component::Normal(_)))
            {
                return Err(bad());
            }
        }
    }
    Ok(())
}

/// Bytes per second from librqbit's speed (MiB/s).
fn bps(mib_per_s: f64) -> u64 {
    (mib_per_s * 1024.0 * 1024.0).max(0.0) as u64
}

fn limit(kib: u32) -> Option<NonZeroU32> {
    NonZeroU32::new(kib.saturating_mul(1024))
}

impl Torrents {
    pub fn new(
        cfg: TorrentConfig,
        state_dir: &Path,
        changed: broadcast::Sender<()>,
        trash: Trasher,
    ) -> io::Result<Self> {
        let dir = state_dir.join("torrents");
        fs::create_dir_all(&dir)?;
        let entries = load_records(&state_dir.join(RECORDS_FILE))
            .into_iter()
            .map(|rec| Entry {
                rec,
                rt: Runtime::default(),
            })
            .collect();
        Ok(Self {
            cfg,
            dir,
            state_dir: state_dir.to_path_buf(),
            session: OnceCell::new(),
            st: Mutex::new(State {
                entries,
                ..Default::default()
            }),
            changed,
            trash,
            closed: AtomicBool::new(false),
        })
    }

    fn notify(&self) {
        let _ = self.changed.send(());
    }

    pub fn contains(&self, id: &str) -> bool {
        lock(&self.st).entries.iter().any(|e| e.rec.id == id)
    }

    pub fn is_empty(&self) -> bool {
        lock(&self.st).entries.is_empty()
    }

    fn settings(&self) -> Settings {
        lock(&self.st).settings.clone().unwrap_or_default()
    }

    fn metainfo_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.torrent"))
    }

    pub fn persist(&self) {
        if self.closed.load(Ordering::SeqCst) {
            return;
        }
        let records: Vec<TorrentRecord> = lock(&self.st)
            .entries
            .iter()
            .map(|e| e.rec.clone())
            .collect();
        match serde_json::to_vec_pretty(&records) {
            Ok(bytes) => {
                if let Err(e) = store::write_atomic(&self.state_dir.join(RECORDS_FILE), &bytes) {
                    tracing::error!("couldn't save the torrent list: {e}");
                }
            }
            Err(e) => tracing::error!("couldn't serialize the torrent list: {e}"),
        }
    }

    /// The librqbit session, started on first use so Fetchlane opens no
    /// network ports until torrents are used.
    async fn session(&self) -> Result<Arc<Session>, DownloadError> {
        self.session
            .get_or_try_init(|| async {
                let cfg = &self.cfg;
                let settings = self.settings();
                let opts = SessionOptions {
                    dht: cfg.enable_dht.then(|| DhtSessionConfig {
                        persistence: Some(DhtPersistenceConfig {
                            config_filename: Some(self.dir.join("dht.json")),
                            dump_interval: None,
                        }),
                        ..Default::default()
                    }),
                    disable_trackers: !cfg.enable_trackers,
                    disable_local_service_discovery: !cfg.enable_dht,
                    listen: Some(ListenerOptions {
                        listen_addr: cfg.listen_addr,
                        ..Default::default()
                    }),
                    ratelimits: librqbit::limits::LimitsConfig {
                        download_bps: limit(settings.torrent_download_limit_kib),
                        upload_bps: limit(settings.torrent_upload_limit_kib),
                    },
                    client_name_and_version: Some(format!(
                        "Fetchlane {}",
                        env!("CARGO_PKG_VERSION")
                    )),
                    ..Default::default()
                };
                Session::new_with_opts(self.dir.join("unused-default"), opts)
                    .await
                    .map_err(|e| torrent_error("BitTorrent couldn't start", e))
            })
            .await
            .cloned()
    }

    /// Apply new settings: speed limits now, slot and seeding limits on the
    /// next tick.
    pub fn apply_settings(&self, settings: &Settings) {
        lock(&self.st).settings = Some(settings.clone());
        if let Some(session) = self.session.get() {
            session
                .ratelimits
                .set_download_bps(limit(settings.torrent_download_limit_kib));
            session
                .ratelimits
                .set_upload_bps(limit(settings.torrent_upload_limit_kib));
        }
    }

    /* ---------------- preview ---------------- */

    pub async fn probe(
        &self,
        source: TorrentSource,
        probe_id: String,
        dest_dir: &Path,
    ) -> Result<TorrentPreview, DownloadError> {
        let cancel = CancellationToken::new();
        lock(&self.st)
            .fetches
            .insert(probe_id.clone(), cancel.clone());
        let result = self
            .probe_inner(source, &probe_id, dest_dir, &cancel, None)
            .await;
        lock(&self.st).fetches.remove(&probe_id);
        result
    }

    /// Stop fetching a magnet's details (the Cancel button).
    pub fn cancel_probe(&self, probe_id: &str) {
        if let Some(t) = lock(&self.st).fetches.remove(probe_id) {
            t.cancel();
        }
        lock(&self.st).probes.remove(probe_id);
    }

    /// `own_id` is the torrent being fetched in the background, which is
    /// already in the list and mustn't count as a duplicate of itself.
    async fn probe_inner(
        &self,
        source: TorrentSource,
        probe_id: &str,
        dest_dir: &Path,
        cancel: &CancellationToken,
        own_id: Option<&str>,
    ) -> Result<TorrentPreview, DownloadError> {
        let (add, magnet) = match &source {
            TorrentSource::Magnet(m) => {
                let m = m.trim();
                librqbit_core::magnet::Magnet::parse(m)
                    .map_err(|_| DownloadError::invalid("That magnet link isn't valid."))?;
                (AddTorrent::from_url(m.to_string()), Some(m.to_string()))
            }
            TorrentSource::File(path) => (AddTorrent::from_bytes(read_torrent_file(path)?), None),
        };
        let session = self.session().await?;
        let opts = AddTorrentOptions {
            list_only: true,
            initial_peers: (!self.cfg.extra_peers.is_empty()).then(|| self.cfg.extra_peers.clone()),
            ..Default::default()
        };
        let resp = tokio::select! {
            _ = cancel.cancelled() => return Err(DownloadError::invalid("Fetching torrent details was cancelled.")),
            r = session.add_torrent(add, Some(opts)) => r,
        };
        let list = match resp.map_err(|e| torrent_error("The torrent couldn't be read", e))? {
            AddTorrentResponse::ListOnly(l) => l,
            _ => {
                return Err(DownloadError::internal(
                    "Unexpected response while reading the torrent.",
                ))
            }
        };
        let info_hash = list.info_hash.as_string();
        if lock(&self.st)
            .entries
            .iter()
            .any(|e| e.rec.info_hash == info_hash && Some(e.rec.id.as_str()) != own_id)
        {
            return Err(DownloadError::invalid(
                "This torrent is already in your list.",
            ));
        }
        let mut files = Vec::new();
        let mut parts_all = Vec::new();
        for (index, fd) in list.info.iter_file_details().enumerate() {
            let parts = fd.filename.to_vec();
            files.push(TorrentFile {
                index,
                path: parts.join("/"),
                size: fd.len,
            });
            parts_all.push(parts);
        }
        check_safe_names(parts_all.iter().map(Vec::as_slice))?;
        let name = list
            .info
            .name()
            .map(|n| n.into_owned())
            .unwrap_or_else(|| "torrent".into());
        let name = filename::sanitize(&name);
        let multi = files.len() > 1;
        let save_as = self.output_name(
            dest_dir,
            &name,
            multi,
            files.first().map(|f| f.path.as_str()),
            own_id,
        );
        let trackers = librqbit_core::torrent_metainfo::torrent_from_bytes(&list.torrent_bytes)
            .map(|t| {
                t.iter_announce()
                    .map(|u| String::from_utf8_lossy(u.as_ref()).into_owned())
                    .collect()
            })
            .unwrap_or_default();
        let preview = TorrentPreview {
            probe_id: probe_id.to_string(),
            name,
            info_hash,
            total_size: files.iter().map(|f| f.size).sum(),
            files,
            trackers,
            save_as,
        };
        lock(&self.st).probes.insert(
            probe_id.to_string(),
            Probe {
                bytes: list.torrent_bytes.clone(),
                magnet,
                preview: preview.clone(),
            },
        );
        Ok(preview)
    }

    /// Name of the file or folder the torrent will create in `dest_dir`,
    /// numbered so it never reuses an existing one.
    fn output_name(
        &self,
        dest_dir: &Path,
        name: &str,
        multi: bool,
        single_path: Option<&str>,
        own_id: Option<&str>,
    ) -> String {
        let st = lock(&self.st);
        let taken = |candidate: &str| {
            dest_dir.join(candidate).exists()
                || st
                    .entries
                    .iter()
                    .filter(|e| Some(e.rec.id.as_str()) != own_id)
                    .any(|e| {
                        e.rec.output_folder == dest_dir.join(candidate)
                            || (e.rec.output_folder == dest_dir && e.rec.name == candidate)
                    })
        };
        if multi {
            filename::unique(name, taken)
        } else {
            let file = single_path
                .map(filename::sanitize)
                .unwrap_or_else(|| name.to_string());
            if taken(&file) {
                // The file name is fixed by the torrent; use a folder instead.
                filename::unique(&strip_ext(&file), taken)
            } else {
                file
            }
        }
    }

    /* ---------------- add ---------------- */

    pub async fn add(
        self: &Arc<Self>,
        req: AddTorrentRequest,
        default_dir: &Path,
    ) -> Result<String, DownloadError> {
        let dest_dir = req
            .dest_dir
            .clone()
            .unwrap_or_else(|| default_dir.to_path_buf());
        if !dest_dir.is_dir() {
            return Err(DownloadError::destination_unavailable());
        }
        let id = uuid::Uuid::new_v4().simple().to_string();
        if let Some(probe_id) = &req.probe_id {
            let probe = lock(&self.st).probes.remove(probe_id).ok_or_else(|| {
                DownloadError::invalid("The torrent details expired. Add the torrent again.")
            })?;
            let rec = self.record_from_preview(
                &id,
                &probe.preview,
                probe.magnet.clone(),
                &dest_dir,
                req.selected.clone(),
                req.start_paused,
            )?;
            fs::write(self.metainfo_path(&id), &probe.bytes)
                .map_err(|e| DownloadError::from_io(&e))?;
            self.insert(rec)?;
            self.attach(&id, probe.bytes).await;
        } else if let Some(magnet) = &req.magnet {
            let m = librqbit_core::magnet::Magnet::parse(magnet.trim())
                .map_err(|_| DownloadError::invalid("That magnet link isn't valid."))?;
            let info_hash = m.as_id20().map(|h| h.as_string()).unwrap_or_default();
            if !info_hash.is_empty()
                && lock(&self.st)
                    .entries
                    .iter()
                    .any(|e| e.rec.info_hash == info_hash)
            {
                return Err(DownloadError::invalid(
                    "This torrent is already in your list.",
                ));
            }
            let rec = TorrentRecord {
                id: id.clone(),
                info_hash,
                name: m
                    .name
                    .clone()
                    .map(|n| filename::sanitize(&n))
                    .unwrap_or_else(|| "Magnet link".into()),
                magnet: Some(magnet.trim().to_string()),
                output_folder: dest_dir.clone(),
                dest_dir,
                selected: None,
                has_metadata: false,
                total_size: None,
                file_count: 0,
                paused: req.start_paused,
                stopped_by_limit: false,
                ignore_limits: false,
                uploaded: 0,
                seeded_secs: 0,
                error: None,
                created_at: now_ms(),
                completed_at: None,
            };
            self.insert(rec)?;
            if !req.start_paused {
                self.spawn_fetch(&id);
            }
        } else {
            return Err(DownloadError::invalid(
                "Choose a torrent file or a magnet link.",
            ));
        }
        self.persist();
        self.notify();
        Ok(id)
    }

    fn record_from_preview(
        &self,
        id: &str,
        p: &TorrentPreview,
        magnet: Option<String>,
        dest_dir: &Path,
        selected: Option<Vec<usize>>,
        paused: bool,
    ) -> Result<TorrentRecord, DownloadError> {
        let selected = selected.filter(|s| s.len() < p.files.len());
        if let Some(s) = &selected {
            if s.is_empty() {
                return Err(DownloadError::invalid(
                    "Choose at least one file to download.",
                ));
            }
            if s.iter().any(|&i| i >= p.files.len()) {
                return Err(DownloadError::invalid(
                    "That file selection doesn't match the torrent.",
                ));
            }
        }
        let multi = p.files.len() > 1;
        let save_as = self.output_name(
            dest_dir,
            &p.name,
            multi,
            p.files.first().map(|f| f.path.as_str()),
            Some(id),
        );
        let single_in_dest = !multi && save_as == filename::sanitize(&p.files[0].path);
        let output_folder = if single_in_dest {
            dest_dir.to_path_buf()
        } else {
            dest_dir.join(&save_as)
        };
        let total = p
            .files
            .iter()
            .filter(|f| selected.as_ref().is_none_or(|s| s.contains(&f.index)))
            .map(|f| f.size)
            .sum();
        Ok(TorrentRecord {
            id: id.to_string(),
            info_hash: p.info_hash.clone(),
            name: p.name.clone(),
            magnet,
            output_folder,
            dest_dir: dest_dir.to_path_buf(),
            selected,
            has_metadata: true,
            total_size: Some(total),
            file_count: p.files.len() as u32,
            paused,
            stopped_by_limit: false,
            ignore_limits: false,
            uploaded: 0,
            seeded_secs: 0,
            error: None,
            created_at: now_ms(),
            completed_at: None,
        })
    }

    fn insert(&self, rec: TorrentRecord) -> Result<(), DownloadError> {
        let mut st = lock(&self.st);
        if !rec.info_hash.is_empty() && st.entries.iter().any(|e| e.rec.info_hash == rec.info_hash)
        {
            return Err(DownloadError::invalid(
                "This torrent is already in your list.",
            ));
        }
        st.entries.push(Entry {
            rec,
            rt: Runtime {
                busy: true,
                ..Default::default()
            },
        });
        Ok(())
    }

    /// Hand a torrent with known metadata to librqbit, paused. The scheduler
    /// starts it when it should run. Existing data is verified first.
    async fn attach(&self, id: &str, bytes: bytes::Bytes) {
        let result = async {
            let (output_folder, selected) = {
                let st = lock(&self.st);
                let e = st
                    .entries
                    .iter()
                    .find(|e| e.rec.id == id)
                    .ok_or_else(not_found)?;
                (e.rec.output_folder.clone(), e.rec.selected.clone())
            };
            if output_folder.parent().is_some_and(|p| !p.is_dir()) {
                return Err(DownloadError::destination_unavailable());
            }
            let session = self.session().await?;
            let opts = AddTorrentOptions {
                paused: true,
                only_files: selected,
                overwrite: true,
                output_folder: Some(output_folder.to_string_lossy().into_owned()),
                initial_peers: (!self.cfg.extra_peers.is_empty())
                    .then(|| self.cfg.extra_peers.clone()),
                ..Default::default()
            };
            let resp = session
                .add_torrent(AddTorrent::from_bytes(bytes), Some(opts))
                .await
                .map_err(|e| torrent_error("The torrent couldn't be started", e))?;
            resp.into_handle()
                .ok_or_else(|| DownloadError::internal("The torrent couldn't be started."))
        }
        .await;
        let mut st = lock(&self.st);
        if let Some(e) = st.entries.iter_mut().find(|e| e.rec.id == id) {
            e.rt.busy = false;
            match result {
                Ok(h) => {
                    e.rt.handle = Some(h);
                    e.rec.error = None;
                }
                Err(err) => {
                    e.rec.error = Some(ErrorInfo {
                        kind: err.kind,
                        message: err.message,
                    })
                }
            }
        }
        drop(st);
        self.notify();
    }

    /// Fetch a magnet's metadata in the background, then attach it with all
    /// files selected.
    fn spawn_fetch(self: &Arc<Self>, id: &str) {
        let this = self.clone();
        let token = CancellationToken::new();
        let magnet = {
            let mut st = lock(&self.st);
            let Some(e) = st.entries.iter_mut().find(|e| e.rec.id == id) else {
                return;
            };
            if let Some(old) = e.rt.fetch.replace(token.clone()) {
                old.cancel();
            }
            e.rt.busy = false;
            e.rec.error = None;
            e.rec.magnet.clone().unwrap_or_default()
        };
        let id = id.to_string();
        tokio::spawn(async move {
            let probe_id = format!("fetch-{id}");
            let dest = {
                let st = lock(&this.st);
                st.entries
                    .iter()
                    .find(|e| e.rec.id == id)
                    .map(|e| e.rec.dest_dir.clone())
            };
            let Some(dest) = dest else { return };
            let res = tokio::select! {
                _ = token.cancelled() => return,
                r = this.probe_inner(TorrentSource::Magnet(magnet.clone()), &probe_id, &dest, &token, Some(&id)) => r,
            };
            let probe = lock(&this.st).probes.remove(&probe_id);
            match (res, probe) {
                (Ok(_), Some(probe)) => {
                    let rec = {
                        let st = lock(&this.st);
                        st.entries
                            .iter()
                            .find(|e| e.rec.id == id)
                            .map(|e| (e.rec.paused, e.rec.created_at))
                    };
                    let Some((paused, created_at)) = rec else {
                        return;
                    };
                    match this.record_from_preview(
                        &id,
                        &probe.preview,
                        Some(magnet),
                        &dest,
                        None,
                        paused,
                    ) {
                        Ok(mut rec) => {
                            rec.created_at = created_at;
                            if let Err(e) = fs::write(this.metainfo_path(&id), &probe.bytes) {
                                this.set_error(&id, DownloadError::from_io(&e));
                                return;
                            }
                            {
                                let mut st = lock(&this.st);
                                if let Some(e) = st.entries.iter_mut().find(|e| e.rec.id == id) {
                                    e.rec = rec;
                                    e.rt.fetch = None;
                                    e.rt.busy = true;
                                }
                            }
                            this.persist();
                            this.attach(&id, probe.bytes).await;
                        }
                        Err(e) => this.set_error(&id, e),
                    }
                }
                (Err(e), _) if !token.is_cancelled() => this.set_error(&id, e),
                _ => {}
            }
            this.persist();
            this.notify();
        });
    }

    fn set_error(&self, id: &str, err: DownloadError) {
        let mut st = lock(&self.st);
        if let Some(e) = st.entries.iter_mut().find(|e| e.rec.id == id) {
            e.rec.error = Some(ErrorInfo {
                kind: err.kind,
                message: err.message,
            });
            e.rt.fetch = None;
            e.rt.busy = false;
        }
        drop(st);
        self.persist();
        self.notify();
    }

    /* ---------------- start-up and scheduling ---------------- */

    /// Re-add every saved torrent after the app starts.
    pub async fn restore(self: &Arc<Self>) {
        let ids: Vec<(String, bool)> = {
            let mut st = lock(&self.st);
            for e in st.entries.iter_mut() {
                e.rt.busy = e.rec.has_metadata;
            }
            st.entries
                .iter()
                .map(|e| (e.rec.id.clone(), e.rec.has_metadata))
                .collect()
        };
        for (id, has_metadata) in ids {
            if has_metadata {
                match fs::read(self.metainfo_path(&id)) {
                    Ok(bytes) => self.attach(&id, bytes.into()).await,
                    Err(e) => self.set_error(
                        &id,
                        DownloadError::new(
                            ErrorKind::FileSystem,
                            format!("The saved torrent file is missing: {e}"),
                        ),
                    ),
                }
            } else {
                let paused = lock(&self.st)
                    .entries
                    .iter()
                    .any(|e| e.rec.id == id && e.rec.paused);
                if !paused {
                    self.spawn_fetch(&id);
                }
            }
        }
    }

    /// Start, pause and stop torrents to match the user's wishes, the slot
    /// limit and the seeding limits. Called about once a second.
    pub async fn tick(&self) {
        let settings = self.settings();
        let mut to_pause = Vec::new();
        let mut to_start = Vec::new();
        let mut changed = false;
        {
            let mut st = lock(&self.st);
            let now = Instant::now();
            let mut slots = settings.max_active_torrents as usize;
            for e in st.entries.iter_mut() {
                let Some(h) = e.rt.handle.clone() else {
                    continue;
                };
                if e.rt.busy {
                    continue;
                }
                let stats = h.stats();
                let live = matches!(stats.state, TorrentStatsState::Live);
                let initializing = matches!(stats.state, TorrentStatsState::Initializing { .. });

                // Upload accounting survives pauses and restarts.
                let up = if live { stats.uploaded_bytes } else { 0 };
                let delta = if up >= e.rt.last_uploaded_live {
                    up - e.rt.last_uploaded_live
                } else {
                    up
                };
                if delta > 0 {
                    e.rec.uploaded += delta;
                    changed = true;
                }
                e.rt.last_uploaded_live = up;

                if stats.finished && e.rec.completed_at.is_none() && !initializing {
                    e.rec.completed_at = Some(now_ms());
                    changed = true;
                }
                if !stats.finished
                    && e.rec.completed_at.is_some()
                    && !initializing
                    && matches!(
                        stats.state,
                        TorrentStatsState::Live | TorrentStatsState::Paused
                    )
                {
                    // More files were selected after it finished.
                    e.rec.completed_at = None;
                    changed = true;
                }

                // Seeding time and limits.
                if live && stats.finished {
                    let last = e.rt.seed_tick.replace(now).unwrap_or(now);
                    let secs = now.duration_since(last).as_secs_f64()
                        * (60.0 / self.cfg.minute.as_secs_f64());
                    e.rec.seeded_secs += secs.round() as u64;
                    if !e.rec.ignore_limits && seed_limit_reached(&e.rec, &settings) {
                        e.rec.stopped_by_limit = true;
                        changed = true;
                    }
                } else {
                    e.rt.seed_tick = None;
                }

                // Progress tracking for the stalled state.
                if stats.progress_bytes != e.rt.last_progress || e.rt.last_progress_at.is_none() {
                    e.rt.last_progress = stats.progress_bytes;
                    e.rt.last_progress_at = Some(now);
                }
                if live {
                    e.rt.live_since.get_or_insert(now);
                } else {
                    e.rt.live_since = None;
                }

                let errored = matches!(stats.state, TorrentStatsState::Error);
                // Torrents claim slots in list order, even while checking, so
                // the same torrents keep running from tick to tick.
                let want_run = if e.rec.paused || e.rec.error.is_some() || errored {
                    false
                } else if stats.finished && !initializing {
                    !e.rec.stopped_by_limit
                } else if e.rt.forced {
                    true
                } else if slots > 0 {
                    slots -= 1;
                    true
                } else {
                    false
                };
                if errored || initializing {
                    continue;
                }
                if want_run && !live {
                    to_start.push(h);
                } else if !want_run && live {
                    to_pause.push(h);
                }
            }
        }
        if !to_start.is_empty() || !to_pause.is_empty() {
            if let Some(session) = self.session.get() {
                for h in to_pause {
                    let _ = session.pause(&h).await;
                }
                for h in to_start {
                    if let Err(e) = session.unpause(&h).await {
                        tracing::warn!("couldn't start torrent: {e}");
                    }
                }
            }
            changed = true;
        }
        if changed {
            self.persist();
        }
        if !lock(&self.st).entries.is_empty() {
            self.notify();
        }
    }

    /* ---------------- views ---------------- */

    pub fn views(&self, settings: &Settings) -> Vec<DownloadView> {
        let st = lock(&self.st);
        let mut queue_pos = 0u32;
        let now = Instant::now();
        st.entries
            .iter()
            .map(|e| {
                let v = self.view(e, settings, now);
                (e, v)
            })
            .map(|(e, mut v)| {
                if v.torrent
                    .as_ref()
                    .is_some_and(|t| t.state == TorrentState::Queued)
                {
                    queue_pos += 1;
                    v.queue_position = Some(queue_pos);
                }
                let _ = e;
                v
            })
            .collect()
    }

    fn view(&self, e: &Entry, settings: &Settings, now: Instant) -> DownloadView {
        let rec = &e.rec;
        let stats = e.rt.handle.as_ref().map(|h| h.stats());
        let live = stats.as_ref().and_then(|s| s.live.as_ref());
        let (connected, known, connecting) = live
            .map(|l| {
                let p = &l.snapshot.peer_stats;
                (p.live, p.seen, p.connecting + p.queued)
            })
            .unwrap_or((0, 0, 0));
        let finished = stats.as_ref().is_some_and(|s| s.finished);
        // librqbit counts whole pieces; show the selected files' exact size.
        let total = rec
            .total_size
            .or_else(|| stats.as_ref().map(|s| s.total_bytes).filter(|&t| t > 0));
        let progress = stats.as_ref().map_or(0, |s| s.progress_bytes);
        let downloaded = match total {
            Some(t) if finished => t,
            Some(t) => progress.min(t),
            None => progress,
        };
        let state = if rec.error.is_some() {
            TorrentState::Error
        } else if !rec.has_metadata {
            if rec.paused {
                TorrentState::Paused
            } else {
                TorrentState::Fetching
            }
        } else {
            match stats.as_ref().map(|s| s.state) {
                None => TorrentState::Checking,
                Some(TorrentStatsState::Error) => TorrentState::Error,
                Some(TorrentStatsState::Initializing { .. }) => TorrentState::Checking,
                Some(TorrentStatsState::Paused) => {
                    if finished {
                        TorrentState::Stopped
                    } else if rec.paused {
                        TorrentState::Paused
                    } else {
                        TorrentState::Queued
                    }
                }
                Some(TorrentStatsState::Live) => {
                    if finished {
                        TorrentState::Seeding
                    } else {
                        let quiet =
                            e.rt.last_progress_at
                                .is_some_and(|t| now.duration_since(t) >= self.cfg.stall_after);
                        let started =
                            e.rt.live_since
                                .is_some_and(|t| now.duration_since(t) >= self.cfg.stall_after);
                        if downloaded == 0 && connected == 0 && !started {
                            TorrentState::Connecting
                        } else if quiet && started {
                            TorrentState::Stalled
                        } else {
                            TorrentState::Downloading
                        }
                    }
                }
            }
        };
        let status = match state {
            TorrentState::Queued => Status::Queued,
            TorrentState::Paused => Status::Paused,
            TorrentState::Seeding | TorrentState::Stopped => Status::Completed,
            TorrentState::Error => Status::Failed,
            _ => Status::Downloading,
        };
        let error = rec.error.clone().or_else(|| {
            stats
                .as_ref()
                .and_then(|s| s.error.clone())
                .map(|m| ErrorInfo {
                    kind: ErrorKind::Internal,
                    message: friendly_torrent_error(&m),
                })
        });
        let size_for_ratio = rec.total_size.or(total).unwrap_or(0).max(1);
        let speed = live.map(|l| bps(l.download_speed.mbps));
        let up = live.map(|l| bps(l.upload_speed.mbps));
        let eta = match (speed, total) {
            (Some(s), Some(t))
                if s > 0 && state == TorrentState::Downloading && t >= downloaded =>
            {
                Some((t - downloaded).div_ceil(s))
            }
            _ => None,
        };
        let summary = TorrentSummary {
            state,
            peers_connected: connected,
            peers_known: known.max(connected),
            uploaded: rec.uploaded,
            ratio: rec.uploaded as f64 / size_for_ratio as f64,
            file_count: rec.file_count,
            selected_count: rec
                .selected
                .as_ref()
                .map_or(rec.file_count, |s| s.len() as u32),
            seed_limit_reached: rec.stopped_by_limit,
            info_hash: rec.info_hash.clone(),
        };
        let _ = (connecting, settings);
        DownloadView {
            id: rec.id.clone(),
            kind: DownloadKind::Torrent,
            display_url: format!("magnet:?xt=urn:btih:{}", rec.info_hash),
            hidden_params: 0,
            host: match (&rec.selected, rec.file_count) {
                (_, 0) => "Fetching details".into(),
                (Some(sel), n) => format!("{} of {n} files", sel.len()),
                (None, 1) => "1 file".into(),
                (None, n) => format!("{n} files"),
            },
            file_name: rec.name.clone(),
            dest_dir: rec.dest_dir.clone(),
            status,
            phase: None,
            total_size: total,
            downloaded,
            speed: speed.filter(|_| {
                matches!(
                    state,
                    TorrentState::Downloading | TorrentState::Stalled | TorrentState::Connecting
                )
            }),
            eta_secs: eta,
            resumable: true,
            can_pause: matches!(
                state,
                TorrentState::Downloading
                    | TorrentState::Connecting
                    | TorrentState::Stalled
                    | TorrentState::Queued
                    | TorrentState::Checking
                    | TorrentState::Fetching
            ),
            connections: connected,
            queue_position: None,
            retry_in_secs: None,
            retry_attempt: None,
            retry_limit: 0,
            error: if state == TorrentState::Error {
                error
            } else {
                None
            },
            created_at: rec.created_at,
            // The tick records the time; until then report "now".
            completed_at: rec
                .completed_at
                .or_else(|| (finished && state != TorrentState::Checking).then(now_ms)),
            upload_speed: up.filter(|_| live.is_some()),
            torrent: Some(summary),
        }
    }

    pub fn details(&self, id: &str) -> Result<TorrentDetails, DownloadError> {
        let settings = self.settings();
        let st = lock(&self.st);
        let e = st
            .entries
            .iter()
            .find(|e| e.rec.id == id)
            .ok_or_else(not_found)?;
        let rec = &e.rec;
        let h = e.rt.handle.as_ref();
        let stats = h.map(|h| h.stats());
        let files: Vec<TorrentFileView> = h
            .and_then(|h| {
                h.with_metadata(|m| {
                    m.file_infos
                        .iter()
                        .enumerate()
                        .map(|(i, f)| TorrentFileView {
                            index: i,
                            path: f
                                .relative_filename
                                .components()
                                .map(|c| c.as_os_str().to_string_lossy())
                                .collect::<Vec<_>>()
                                .join("/"),
                            size: f.len,
                            have: stats
                                .as_ref()
                                .and_then(|s| s.file_progress.get(i).copied())
                                .unwrap_or(0),
                            selected: rec.selected.as_ref().is_none_or(|s| s.contains(&i)),
                        })
                        .collect()
                })
                .ok()
            })
            .unwrap_or_default();
        let peers = stats.as_ref().and_then(|s| s.live.as_ref()).map(|l| {
            let p = &l.snapshot.peer_stats;
            (p.live, p.connecting + p.queued, p.seen)
        });
        let trackers = h
            .map(|h| {
                h.shared()
                    .trackers
                    .iter()
                    .map(|u| u.to_string())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let size = rec.total_size.unwrap_or(0).max(1);
        Ok(TorrentDetails {
            files,
            peers_connected: peers.map_or(0, |p| p.0),
            peers_connecting: peers.map_or(0, |p| p.1),
            peers_known: peers.map_or(0, |p| p.2.max(p.0)),
            downloaded: match (stats.as_ref(), rec.total_size) {
                (Some(s), Some(t)) if s.finished => t,
                (Some(s), Some(t)) => s.progress_bytes.min(t),
                (Some(s), None) => s.progress_bytes,
                (None, _) => 0,
            },
            uploaded: rec.uploaded,
            ratio: rec.uploaded as f64 / size as f64,
            trackers,
            seeding: stats
                .as_ref()
                .is_some_and(|s| s.finished && matches!(s.state, TorrentStatsState::Live)),
            seeded_secs: rec.seeded_secs,
            ratio_limit: settings
                .seed_ratio_enabled
                .then(|| settings.seed_ratio_percent as f64 / 100.0),
            time_limit_minutes: settings
                .seed_time_enabled
                .then_some(settings.seed_time_minutes),
            seed_limit_reached: rec.stopped_by_limit,
            info_hash: rec.info_hash.clone(),
            save_path: rec.output_folder.clone(),
        })
    }

    /* ---------------- actions ---------------- */

    fn with_entry<R>(
        &self,
        id: &str,
        f: impl FnOnce(&mut Entry) -> Result<R, DownloadError>,
    ) -> Result<R, DownloadError> {
        let mut st = lock(&self.st);
        let e = st
            .entries
            .iter_mut()
            .find(|e| e.rec.id == id)
            .ok_or_else(not_found)?;
        let r = f(e)?;
        drop(st);
        self.persist();
        self.notify();
        Ok(r)
    }

    /// Pause a download, or stop seeding a finished torrent.
    pub fn pause(&self, id: &str) -> Result<(), DownloadError> {
        let fetch = self.with_entry(id, |e| {
            e.rec.paused = true;
            e.rt.forced = false;
            Ok(e.rt.fetch.take())
        })?;
        if let Some(t) = fetch {
            t.cancel();
        }
        Ok(())
    }

    /// Resume, start seeding again, or retry after an error.
    pub fn resume(self: &Arc<Self>, id: &str, force: bool) -> Result<(), DownloadError> {
        let (needs_fetch, retry_bytes) = self.with_entry(id, |e| {
            let had_error = e.rec.error.take().is_some();
            e.rec.paused = false;
            e.rt.forced = force;
            if e.rec.stopped_by_limit {
                e.rec.stopped_by_limit = false;
                e.rec.ignore_limits = true;
            }
            let needs_fetch = !e.rec.has_metadata && e.rt.fetch.is_none();
            let retry = had_error && e.rec.has_metadata && e.rt.handle.is_none();
            if retry {
                e.rt.busy = true;
            }
            Ok((needs_fetch, retry))
        })?;
        if needs_fetch {
            self.spawn_fetch(id);
        }
        if retry_bytes {
            let this = self.clone();
            let id = id.to_string();
            tokio::spawn(async move {
                match fs::read(this.metainfo_path(&id)) {
                    Ok(bytes) => this.attach(&id, bytes.into()).await,
                    Err(e) => this.set_error(&id, DownloadError::from_io(&e)),
                }
            });
        }
        Ok(())
    }

    /// Check every piece on disk again. Bad or missing data is downloaded again.
    pub async fn recheck(&self, id: &str) -> Result<(), DownloadError> {
        let handle = self.with_entry(id, |e| {
            if e.rt.busy {
                return Err(DownloadError::invalid(
                    "This torrent is busy. Try again in a moment.",
                ));
            }
            if !e.rec.has_metadata {
                return Err(DownloadError::invalid(
                    "The torrent's details haven't been fetched yet.",
                ));
            }
            e.rt.busy = true;
            e.rec.error = None;
            Ok(e.rt.handle.take())
        })?;
        if let (Some(h), Some(session)) = (handle, self.session.get()) {
            if let Err(e) = session.delete(TorrentIdOrHash::Id(h.id()), false).await {
                tracing::warn!("couldn't remove torrent for recheck: {e}");
            }
        }
        let bytes = fs::read(self.metainfo_path(id)).map_err(|e| DownloadError::from_io(&e))?;
        self.attach(id, bytes.into()).await;
        Ok(())
    }

    /// Change which files are downloaded.
    pub async fn set_files(&self, id: &str, selected: Vec<usize>) -> Result<(), DownloadError> {
        if selected.is_empty() {
            return Err(DownloadError::invalid(
                "Choose at least one file to download.",
            ));
        }
        let (handle, sizes) = {
            let st = lock(&self.st);
            let e = st
                .entries
                .iter()
                .find(|e| e.rec.id == id)
                .ok_or_else(not_found)?;
            let h =
                e.rt.handle
                    .clone()
                    .ok_or_else(|| DownloadError::invalid("The torrent isn't ready yet."))?;
            let sizes: Vec<u64> = h
                .with_metadata(|m| m.file_infos.iter().map(|f| f.len).collect())
                .unwrap_or_default();
            (h, sizes)
        };
        if selected.iter().any(|&i| i >= sizes.len()) {
            return Err(DownloadError::invalid(
                "That file selection doesn't match the torrent.",
            ));
        }
        let session = self.session().await?;
        let set: HashSet<usize> = selected.iter().copied().collect();
        session
            .update_only_files(&handle, &set)
            .await
            .map_err(|e| torrent_error("The file selection couldn't be changed", e))?;
        self.with_entry(id, |e| {
            e.rec.total_size = Some(selected.iter().map(|&i| sizes[i]).sum());
            e.rec.selected = (selected.len() < sizes.len()).then_some(selected);
            Ok(())
        })
    }

    /// What deleting this torrent's files would remove.
    pub fn delete_scope(&self, id: &str) -> Result<DeleteScope, DownloadError> {
        let files = self.existing_files(id)?;
        let folder = lock(&self.st)
            .entries
            .iter()
            .find(|e| e.rec.id == id)
            .map(|e| e.rec.output_folder.clone())
            .ok_or_else(not_found)?;
        Ok(DeleteScope {
            file_count: files.len() as u32,
            total_bytes: files
                .iter()
                .filter_map(|p| fs::metadata(p).ok())
                .map(|m| m.len())
                .sum(),
            examples: files
                .iter()
                .take(3)
                .map(|p| {
                    p.strip_prefix(&folder)
                        .unwrap_or(p)
                        .to_string_lossy()
                        .into_owned()
                })
                .collect(),
            folder,
        })
    }

    fn existing_files(&self, id: &str) -> Result<Vec<PathBuf>, DownloadError> {
        let st = lock(&self.st);
        let e = st
            .entries
            .iter()
            .find(|e| e.rec.id == id)
            .ok_or_else(not_found)?;
        let folder = e.rec.output_folder.clone();
        let rel: Vec<PathBuf> = match &e.rt.handle {
            Some(h) => h
                .with_metadata(|m| {
                    m.file_infos
                        .iter()
                        .map(|f| f.relative_filename.clone())
                        .collect()
                })
                .unwrap_or_default(),
            None => Vec::new(),
        };
        Ok(rel
            .into_iter()
            .map(|r| folder.join(r))
            .filter(|p| p.is_file())
            .collect())
    }

    /// Remove from the list; with `delete_files`, also send the torrent's
    /// files to the Recycle Bin (only its own files, never the whole folder).
    pub async fn remove(&self, id: &str, delete_files: bool) -> Result<(), DownloadError> {
        let files = if delete_files {
            self.existing_files(id)?
        } else {
            Vec::new()
        };
        let (handle, fetch, folder, own_folder) = {
            let mut st = lock(&self.st);
            let idx = st
                .entries
                .iter()
                .position(|e| e.rec.id == id)
                .ok_or_else(not_found)?;
            let e = &mut st.entries[idx];
            let own = e.rec.output_folder != e.rec.dest_dir;
            (
                e.rt.handle.take(),
                e.rt.fetch.take(),
                e.rec.output_folder.clone(),
                own,
            )
        };
        if let Some(t) = fetch {
            t.cancel();
        }
        if let (Some(h), Some(session)) = (handle, self.session.get()) {
            if let Err(e) = session.delete(TorrentIdOrHash::Id(h.id()), false).await {
                tracing::warn!("couldn't remove torrent from session: {e}");
            }
        }
        if delete_files {
            let trash = self.trash.clone();
            let result = tokio::task::spawn_blocking(move || -> io::Result<()> {
                for f in &files {
                    (trash.0)(f)?;
                }
                if own_folder {
                    remove_empty_dirs(&folder);
                }
                Ok(())
            })
            .await
            .map_err(|e| DownloadError::internal(e.to_string()))?;
            if let Err(e) = result {
                tracing::warn!("moving torrent files to the Recycle Bin failed: {e}");
                // Keep the entry so the user can try again.
                let bytes = fs::read(self.metainfo_path(id)).ok();
                if let Some(b) = bytes {
                    self.attach(id, b.into()).await;
                }
                return Err(DownloadError::new(
                    ErrorKind::FileSystem,
                    "Some files couldn't be moved to the Recycle Bin. They may be open in another app.",
                ));
            }
        }
        lock(&self.st).entries.retain(|e| e.rec.id != id);
        let _ = fs::remove_file(self.metainfo_path(id));
        self.persist();
        self.notify();
        Ok(())
    }

    pub fn source_link(&self, id: &str) -> Result<String, DownloadError> {
        let st = lock(&self.st);
        let e = st
            .entries
            .iter()
            .find(|e| e.rec.id == id)
            .ok_or_else(not_found)?;
        if let Some(m) = &e.rec.magnet {
            return Ok(m.clone());
        }
        let mut link = format!("magnet:?xt=urn:btih:{}", e.rec.info_hash);
        link.push_str("&dn=");
        link.push_str(
            &percent_encoding::utf8_percent_encode(&e.rec.name, percent_encoding::NON_ALPHANUMERIC)
                .to_string(),
        );
        if let Some(h) = &e.rt.handle {
            for t in &h.shared().trackers {
                link.push_str("&tr=");
                link.push_str(
                    &percent_encoding::utf8_percent_encode(
                        t.as_str(),
                        percent_encoding::NON_ALPHANUMERIC,
                    )
                    .to_string(),
                );
            }
        }
        Ok(link)
    }

    /// The file to open: the single file, or the torrent's folder.
    pub fn open_target(&self, id: &str) -> Result<PathBuf, DownloadError> {
        let files = self.existing_files(id)?;
        let st = lock(&self.st);
        let e = st
            .entries
            .iter()
            .find(|e| e.rec.id == id)
            .ok_or_else(not_found)?;
        if !is_finished(e) {
            return Err(DownloadError::invalid("This download hasn't finished yet."));
        }
        if e.rec.file_count == 1 {
            return files.into_iter().next().ok_or_else(|| {
                DownloadError::new(ErrorKind::FileSystem, "The file was moved or deleted.")
            });
        }
        if e.rec.output_folder.is_dir() {
            Ok(e.rec.output_folder.clone())
        } else {
            Err(DownloadError::new(
                ErrorKind::FileSystem,
                "The folder was moved or deleted.",
            ))
        }
    }

    pub fn reveal_target(&self, id: &str) -> Result<PathBuf, DownloadError> {
        if let Ok(files) = self.existing_files(id) {
            let st = lock(&self.st);
            if let Some(e) = st.entries.iter().find(|e| e.rec.id == id) {
                if e.rec.file_count == 1 {
                    if let Some(f) = files.into_iter().next() {
                        return Ok(f);
                    }
                }
                if e.rec.output_folder.exists() {
                    return Ok(e.rec.output_folder.clone());
                }
                if e.rec.dest_dir.is_dir() {
                    return Ok(e.rec.dest_dir.clone());
                }
            }
        }
        Err(DownloadError::destination_unavailable())
    }

    pub fn clear_finished(&self) -> Vec<String> {
        let ids: Vec<String> = lock(&self.st)
            .entries
            .iter()
            .filter(|e| {
                e.rec.completed_at.is_some()
                    && !matches!(
                        e.rt.handle.as_ref().map(|h| h.stats().state),
                        Some(TorrentStatsState::Live)
                    )
            })
            .map(|e| e.rec.id.clone())
            .collect();
        ids
    }

    pub fn pause_all(&self) {
        let ids: Vec<String> = lock(&self.st)
            .entries
            .iter()
            .filter(|e| e.rec.completed_at.is_none() && !e.rec.paused)
            .map(|e| e.rec.id.clone())
            .collect();
        for id in ids {
            let _ = self.pause(&id);
        }
    }

    pub fn resume_all(self: &Arc<Self>) {
        let ids: Vec<String> = lock(&self.st)
            .entries
            .iter()
            .filter(|e| e.rec.paused && e.rec.completed_at.is_none())
            .map(|e| e.rec.id.clone())
            .collect();
        for id in ids {
            let _ = self.resume(&id, false);
        }
    }

    pub async fn shutdown(&self) {
        // Count uploads made since the last tick before saving.
        self.tick().await;
        self.persist();
        self.closed.store(true, Ordering::SeqCst);
        if let Some(s) = self.session.get() {
            s.stop().await;
        }
    }
}

/// Finished, even if the tick hasn't recorded the completion time yet.
fn is_finished(e: &Entry) -> bool {
    e.rec.completed_at.is_some() || e.rt.handle.as_ref().is_some_and(|h| h.stats().finished)
}

fn seed_limit_reached(rec: &TorrentRecord, s: &Settings) -> bool {
    let size = rec.total_size.unwrap_or(0).max(1) as f64;
    (s.seed_ratio_enabled && rec.uploaded as f64 / size >= s.seed_ratio_percent as f64 / 100.0)
        || (s.seed_time_enabled && rec.seeded_secs >= s.seed_time_minutes as u64 * 60)
}

fn friendly_torrent_error(raw: &str) -> String {
    let first = raw.lines().next().unwrap_or(raw).trim();
    let lower = first.to_ascii_lowercase();
    if lower.contains("no space") || lower.contains("disk full") || lower.contains("os error 112") {
        return "There isn't enough free disk space. Free up space, then retry.".into();
    }
    if lower.contains("access is denied") || lower.contains("permission") {
        return "Fetchlane can't write to the torrent's folder.".into();
    }
    format!(
        "The torrent stopped because of an error ({}). Recheck files or retry.",
        first.chars().take(120).collect::<String>()
    )
}

fn strip_ext(name: &str) -> String {
    match name.rfind('.') {
        Some(i) if i > 0 => name[..i].to_string(),
        _ => name.to_string(),
    }
}

fn read_torrent_file(path: &Path) -> Result<bytes::Bytes, DownloadError> {
    let ok_ext = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("torrent"));
    if !ok_ext {
        return Err(DownloadError::invalid("Choose a .torrent file."));
    }
    let meta = fs::metadata(path)
        .map_err(|_| DownloadError::invalid("That torrent file couldn't be opened."))?;
    if meta.len() > MAX_TORRENT_FILE_BYTES {
        return Err(DownloadError::invalid(
            "That file is too large to be a torrent file.",
        ));
    }
    fs::read(path)
        .map(Into::into)
        .map_err(|_| DownloadError::invalid("That torrent file couldn't be opened."))
}

fn remove_empty_dirs(root: &Path) {
    fn walk(dir: &Path) {
        if let Ok(rd) = fs::read_dir(dir) {
            for entry in rd.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    walk(&p);
                }
            }
        }
        let _ = fs::remove_dir(dir); // only succeeds when empty
    }
    walk(root);
}

fn load_records(path: &Path) -> Vec<TorrentRecord> {
    match fs::read(path) {
        Ok(b) => serde_json::from_slice(&b).unwrap_or_else(|e| {
            tracing::error!("torrent list unreadable, starting empty: {e}");
            let _ = fs::rename(path, path.with_extension("corrupt.json"));
            Vec::new()
        }),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parts(s: &str) -> Vec<String> {
        s.split('/').map(str::to_string).collect()
    }

    #[test]
    fn unsafe_names_are_rejected() {
        let ok = [parts("Album/01 Track.flac"), parts("readme.txt")];
        assert!(check_safe_names(ok.iter().map(Vec::as_slice)).is_ok());
        for bad in [
            "C:/x",
            "a/CON",
            "dir/name.",
            "dir/trail ",
            "a/b|c",
            "x/LPT1.txt",
        ] {
            let v = [parts(bad)];
            assert!(
                check_safe_names(v.iter().map(Vec::as_slice)).is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn seeding_limits() {
        let mut rec: TorrentRecord = serde_json::from_value(serde_json::json!({
            "id": "a", "infoHash": "h", "name": "n", "magnet": null, "outputFolder": "x", "destDir": "x",
            "selected": null, "hasMetadata": true, "totalSize": 1000, "fileCount": 1, "paused": false,
            "stoppedByLimit": false, "uploaded": 500, "seededSecs": 0, "error": null, "createdAt": 0, "completedAt": 1
        }))
        .unwrap();
        let mut s = Settings::default();
        assert!(!seed_limit_reached(&rec, &s)); // 0.5 < 1.0
        rec.uploaded = 1000;
        assert!(seed_limit_reached(&rec, &s));
        s.seed_ratio_enabled = false;
        assert!(!seed_limit_reached(&rec, &s));
        s.seed_time_enabled = true;
        s.seed_time_minutes = 1;
        rec.seeded_secs = 59;
        assert!(!seed_limit_reached(&rec, &s));
        rec.seeded_secs = 60;
        assert!(seed_limit_reached(&rec, &s));
    }
}
