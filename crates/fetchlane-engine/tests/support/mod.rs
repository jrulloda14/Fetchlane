//! A small, deterministic HTTP/1.1 server for engine tests. It speaks just
//! enough HTTP to misbehave on purpose: dropped connections, stalls, ignored
//! or broken ranges, changing resources, redirects and error statuses.

#![allow(dead_code)]

use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use fetchlane_engine::{DownloadView, Engine, EngineConfig, Settings, Trasher};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RangeMode {
    /// Correct range and If-Range handling.
    Supported,
    /// Always sends the full body with 200.
    Ignored,
    /// Honors only the first request's range, then ignores ranges.
    IgnoredAfterFirst,
    /// Honors ranges but never checks If-Range.
    IgnoreIfRange,
    /// Sends 206 with a Content-Range that always claims to start at 0.
    BrokenContentRange,
}

#[derive(Clone)]
pub struct Resource {
    pub body: Arc<Vec<u8>>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub ranges: RangeMode,
    /// false = chunked transfer encoding (unknown length).
    pub content_length: bool,
    pub accept_ranges_header: bool,
    pub disposition: Option<String>,
}

impl Resource {
    pub fn new(body: Vec<u8>) -> Self {
        Self {
            body: Arc::new(body),
            etag: Some("\"v1\"".into()),
            last_modified: Some("Mon, 05 Oct 2026 10:00:00 GMT".into()),
            ranges: RangeMode::Supported,
            content_length: true,
            accept_ranges_header: true,
            disposition: None,
        }
    }

    pub fn ranges(mut self, mode: RangeMode) -> Self {
        self.ranges = mode;
        if mode == RangeMode::Ignored {
            self.accept_ranges_header = false;
        }
        self
    }

    pub fn etag(mut self, etag: Option<&str>) -> Self {
        self.etag = etag.map(str::to_string);
        self
    }

    pub fn no_validators(mut self) -> Self {
        self.etag = None;
        self.last_modified = None;
        self
    }

    pub fn chunked(mut self) -> Self {
        self.content_length = false;
        self
    }

    pub fn disposition(mut self, value: &str) -> Self {
        self.disposition = Some(value.into());
        self
    }
}

pub enum RouteKind {
    File(Resource),
    Redirect { status: u16, location: String },
    Status(u16),
}

pub struct Route {
    pub kind: RouteKind,
    /// Per request, in order: close the connection after this many body bytes.
    pub drops: VecDeque<Option<u64>>,
    /// Per request: pause for this long after this many body bytes.
    pub stalls: VecDeque<Option<(u64, Duration)>>,
    /// Statuses to answer with before serving normally.
    pub fail_statuses: VecDeque<u16>,
    /// (chunk size, delay between chunks)
    pub throttle: Option<(usize, Duration)>,
    /// Swap the resource for this one right after a dropped connection.
    pub replace_after_drop: Option<Resource>,
    served: usize,
}

impl Route {
    fn new(kind: RouteKind) -> Self {
        Self {
            kind,
            drops: VecDeque::new(),
            stalls: VecDeque::new(),
            fail_statuses: VecDeque::new(),
            throttle: None,
            replace_after_drop: None,
            served: 0,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Logged {
    pub method: String,
    pub path: String,
    pub range: Option<String>,
    pub if_range: Option<String>,
}

#[derive(Default)]
struct Stats {
    log: Vec<Logged>,
    active: HashMap<String, usize>,
    max_active: HashMap<String, usize>,
    bytes_sent: HashMap<String, u64>,
    /// (start, end) of each GET, ending when the client hangs up.
    windows: HashMap<String, Vec<(Instant, Instant)>>,
}

#[derive(Default)]
struct ServerState {
    routes: Mutex<HashMap<String, Route>>,
    stats: Mutex<Stats>,
}

pub struct TestServer {
    addr: SocketAddr,
    state: Arc<ServerState>,
}

impl TestServer {
    pub async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let state = Arc::new(ServerState::default());
        let st = state.clone();
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                let st = st.clone();
                tokio::spawn(async move {
                    let _ = handle(stream, st).await;
                });
            }
        });
        Self { addr, state }
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://{}{}", self.addr, path)
    }

    pub fn file(&self, path: &str, resource: Resource) {
        self.route(path, RouteKind::File(resource));
    }

    pub fn route(&self, path: &str, kind: RouteKind) {
        self.state
            .routes
            .lock()
            .unwrap()
            .insert(path.to_string(), Route::new(kind));
    }

    pub fn configure(&self, path: &str, f: impl FnOnce(&mut Route)) {
        f(self
            .state
            .routes
            .lock()
            .unwrap()
            .get_mut(path)
            .expect("route exists"));
    }

    pub fn requests(&self, path: &str) -> Vec<Logged> {
        self.state
            .stats
            .lock()
            .unwrap()
            .log
            .iter()
            .filter(|l| l.path == path && l.method == "GET")
            .cloned()
            .collect()
    }

    /// Paths in the order their first GET arrived.
    pub fn start_order(&self) -> Vec<String> {
        let mut seen = Vec::new();
        for l in &self.state.stats.lock().unwrap().log {
            if l.method == "GET" && !seen.contains(&l.path) {
                seen.push(l.path.clone());
            }
        }
        seen
    }

    pub fn max_active(&self, path: &str) -> usize {
        self.state
            .stats
            .lock()
            .unwrap()
            .max_active
            .get(path)
            .copied()
            .unwrap_or(0)
    }

    /// Longest time two requests for `path` were open at the same time.
    pub fn max_overlap(&self, path: &str) -> Duration {
        let stats = self.state.stats.lock().unwrap();
        let mut w = stats.windows.get(path).cloned().unwrap_or_default();
        w.sort();
        let mut worst = Duration::ZERO;
        for i in 0..w.len() {
            for j in i + 1..w.len() {
                let start = w[j].0.max(w[i].0);
                let end = w[j].1.min(w[i].1);
                worst = worst.max(end.saturating_duration_since(start));
            }
        }
        worst
    }

    pub fn bytes_sent(&self, path: &str) -> u64 {
        self.state
            .stats
            .lock()
            .unwrap()
            .bytes_sent
            .get(path)
            .copied()
            .unwrap_or(0)
    }
}

struct ActiveGuard {
    state: Arc<ServerState>,
    path: String,
    started: Instant,
}

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        let mut stats = self.state.stats.lock().unwrap();
        *stats.active.entry(self.path.clone()).or_default() -= 1;
        stats
            .windows
            .entry(self.path.clone())
            .or_default()
            .push((self.started, Instant::now()));
    }
}

struct Plan {
    head: String,
    body: Option<(Arc<Vec<u8>>, usize, usize)>,
    chunked: bool,
    drop_after: Option<u64>,
    stall: Option<(u64, Duration)>,
    throttle: Option<(usize, Duration)>,
}

async fn handle(stream: TcpStream, state: Arc<ServerState>) -> std::io::Result<()> {
    let (read, mut write) = stream.into_split();
    let mut reader = BufReader::new(read);
    let mut line = String::new();
    reader.read_line(&mut line).await?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("/").to_string();
    let mut headers = HashMap::new();
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).await? == 0 || h == "\r\n" {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let range = headers.get("range").cloned();
    let if_range = headers.get("if-range").cloned();
    {
        let mut stats = state.stats.lock().unwrap();
        stats.log.push(Logged {
            method: method.clone(),
            path: path.clone(),
            range: range.clone(),
            if_range: if_range.clone(),
        });
        let active = stats.active.entry(path.clone()).or_default();
        *active += 1;
        let now = *active;
        let max = stats.max_active.entry(path.clone()).or_default();
        *max = (*max).max(now);
    }
    let _guard = ActiveGuard {
        state: state.clone(),
        path: path.clone(),
        started: Instant::now(),
    };

    let plan = make_plan(
        &state,
        &method,
        &path,
        range.as_deref(),
        if_range.as_deref(),
    );
    // Stop as soon as the client hangs up, like a real server would.
    let hangup = async move {
        let mut buf = [0u8; 64];
        while reader.read(&mut buf).await.is_ok_and(|n| n > 0) {}
    };
    tokio::select! {
        r = respond(&state, &path, plan, &mut write) => r,
        _ = hangup => Ok(()),
    }
}

async fn respond(
    state: &ServerState,
    path: &str,
    plan: Plan,
    write: &mut tokio::net::tcp::OwnedWriteHalf,
) -> std::io::Result<()> {
    write.write_all(plan.head.as_bytes()).await?;
    let Some((body, start, end)) = plan.body else {
        return write.flush().await;
    };
    let (chunk, delay) = plan.throttle.unwrap_or((16 * 1024, Duration::ZERO));
    let mut sent = 0u64;
    let mut pos = start;
    let mut stall = plan.stall;
    while pos < end {
        let mut n = chunk.min(end - pos);
        if let Some(limit) = plan.drop_after {
            if sent + n as u64 >= limit {
                n = (limit - sent) as usize;
                write_data(write, &body[pos..pos + n], plan.chunked).await?;
                add_sent(state, path, n as u64);
                write.flush().await?;
                // Close without finishing the body.
                return Ok(());
            }
        }
        write_data(write, &body[pos..pos + n], plan.chunked).await?;
        add_sent(state, path, n as u64);
        sent += n as u64;
        pos += n;
        if let Some((at, wait)) = stall {
            if sent >= at {
                write.flush().await?;
                tokio::time::sleep(wait).await;
                stall = None;
            }
        }
        if !delay.is_zero() {
            write.flush().await?;
            tokio::time::sleep(delay).await;
        }
    }
    if plan.chunked {
        write.write_all(b"0\r\n\r\n").await?;
    }
    write.flush().await
}

fn add_sent(state: &ServerState, path: &str, n: u64) {
    *state
        .stats
        .lock()
        .unwrap()
        .bytes_sent
        .entry(path.to_string())
        .or_default() += n;
}

async fn write_data(
    w: &mut tokio::net::tcp::OwnedWriteHalf,
    data: &[u8],
    chunked: bool,
) -> std::io::Result<()> {
    if chunked {
        if data.is_empty() {
            return Ok(());
        }
        w.write_all(format!("{:x}\r\n", data.len()).as_bytes())
            .await?;
        w.write_all(data).await?;
        w.write_all(b"\r\n").await
    } else {
        w.write_all(data).await
    }
}

fn simple(status: u16, extra: &str) -> Plan {
    Plan {
        head: format!(
            "HTTP/1.1 {status} Test\r\nContent-Length: 0\r\nConnection: close\r\n{extra}\r\n"
        ),
        body: None,
        chunked: false,
        drop_after: None,
        stall: None,
        throttle: None,
    }
}

fn parse_range(v: &str) -> Option<(usize, Option<usize>)> {
    let spec = v.strip_prefix("bytes=")?;
    let (a, b) = spec.split_once('-')?;
    let a = a.trim().parse().ok()?;
    let b = if b.trim().is_empty() {
        None
    } else {
        Some(b.trim().parse().ok()?)
    };
    Some((a, b))
}

fn make_plan(
    state: &ServerState,
    method: &str,
    path: &str,
    range: Option<&str>,
    if_range: Option<&str>,
) -> Plan {
    let mut routes = state.routes.lock().unwrap();
    let Some(route) = routes.get_mut(path) else {
        return simple(404, "");
    };
    let is_get = method == "GET";
    if is_get {
        if let Some(status) = route.fail_statuses.pop_front() {
            return simple(status, "");
        }
    }
    let res = match &route.kind {
        RouteKind::Status(s) => return simple(*s, ""),
        RouteKind::Redirect { status, location } => {
            return simple(*status, &format!("Location: {location}\r\n"))
        }
        RouteKind::File(r) => r.clone(),
    };
    let served_before = route.served;
    let (drop_after, stall) = if is_get {
        route.served += 1;
        (
            route.drops.pop_front().flatten(),
            route.stalls.pop_front().flatten(),
        )
    } else {
        (None, None)
    };
    if drop_after.is_some() {
        if let Some(next) = route.replace_after_drop.take() {
            route.kind = RouteKind::File(next);
        }
    }
    let len = res.body.len();
    let honor = match res.ranges {
        RangeMode::Ignored => false,
        RangeMode::IgnoredAfterFirst => served_before == 0,
        _ => true,
    };
    let if_range_ok = res.ranges == RangeMode::IgnoreIfRange
        || if_range.is_none_or(|v| {
            Some(v) == res.etag.as_deref() || Some(v) == res.last_modified.as_deref()
        });

    let mut head = String::new();
    let mut slice = (0, len);
    match range.and_then(parse_range).filter(|_| honor && if_range_ok) {
        Some((a, _)) if a >= len => {
            return simple(416, &format!("Content-Range: bytes */{len}\r\n"));
        }
        Some((a, b)) => {
            let b = b.unwrap_or(len - 1).min(len - 1);
            slice = (a, b + 1);
            let cr = if res.ranges == RangeMode::BrokenContentRange {
                format!("bytes 0-{}/{len}", len - 1)
            } else {
                format!("bytes {a}-{b}/{len}")
            };
            head.push_str(&format!(
                "HTTP/1.1 206 Partial Content\r\nContent-Range: {cr}\r\n"
            ));
        }
        None => head.push_str("HTTP/1.1 200 OK\r\n"),
    }
    if res.content_length {
        head.push_str(&format!("Content-Length: {}\r\n", slice.1 - slice.0));
    } else {
        head.push_str("Transfer-Encoding: chunked\r\n");
    }
    if let Some(e) = &res.etag {
        head.push_str(&format!("ETag: {e}\r\n"));
    }
    if let Some(lm) = &res.last_modified {
        head.push_str(&format!("Last-Modified: {lm}\r\n"));
    }
    if res.accept_ranges_header {
        head.push_str("Accept-Ranges: bytes\r\n");
    }
    if let Some(d) = &res.disposition {
        head.push_str(&format!("Content-Disposition: {d}\r\n"));
    }
    head.push_str("Content-Type: application/octet-stream\r\nConnection: close\r\n\r\n");
    Plan {
        head,
        body: is_get.then(|| (res.body.clone(), slice.0, slice.1)),
        chunked: !res.content_length,
        drop_after,
        stall,
        throttle: route.throttle,
    }
}

// ---------------------------------------------------------------------------
// Engine helpers

/// Deterministic, non-repeating-looking test data.
pub fn pattern(len: usize, seed: u64) -> Vec<u8> {
    let mut x = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            (x >> 24) as u8
        })
        .collect()
}

pub fn test_config() -> EngineConfig {
    EngineConfig {
        connect_timeout: Duration::from_secs(2),
        read_timeout: Duration::from_millis(700),
        response_timeout: Duration::from_secs(2),
        backoff_base: Duration::from_millis(10),
        backoff_max: Duration::from_millis(50),
        checkpoint_bytes: 32 * 1024,
        checkpoint_interval: Duration::from_millis(50),
        min_segment_size: 64 * 1024,
        tick_interval: Duration::from_millis(50),
        persist_debounce: Duration::from_millis(10),
        shutdown_grace: Duration::from_secs(3),
        ..EngineConfig::default()
    }
}

pub struct Env {
    pub _tmp: tempfile::TempDir,
    pub state_dir: PathBuf,
    pub downloads: PathBuf,
    /// Stand-in for the Recycle Bin.
    pub bin: PathBuf,
}

impl Env {
    pub fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let state_dir = tmp.path().join("state");
        let downloads = tmp.path().join("downloads");
        let bin = tmp.path().join("bin");
        std::fs::create_dir_all(&downloads).unwrap();
        std::fs::create_dir_all(&bin).unwrap();
        Self {
            _tmp: tmp,
            state_dir,
            downloads,
            bin,
        }
    }

    pub async fn engine(&self, connections: u8, max_concurrent: u8) -> Engine {
        self.engine_with(
            self.with_fake_bin(test_config()),
            connections,
            max_concurrent,
        )
        .await
    }

    pub async fn engine_with(
        &self,
        cfg: EngineConfig,
        connections: u8,
        max_concurrent: u8,
    ) -> Engine {
        let engine = Engine::open(&self.state_dir, cfg).await.unwrap();
        engine
            .update_settings(Settings {
                download_dir: self.downloads.clone(),
                max_concurrent,
                connections_per_download: connections,
                auto_resume: true,
                retry_attempts: 3,
                ..engine.settings()
            })
            .unwrap();
        engine
    }

    /// Route "move to Recycle Bin" into `self.bin` instead of the real one.
    pub fn with_fake_bin(&self, mut cfg: EngineConfig) -> EngineConfig {
        let bin = self.bin.clone();
        cfg.trash = Trasher(Arc::new(move |path: &Path| {
            std::fs::rename(path, bin.join(path.file_name().unwrap()))
        }));
        cfg
    }

    pub fn read(&self, name: &str) -> Vec<u8> {
        std::fs::read(self.downloads.join(name)).unwrap_or_else(|e| panic!("reading {name}: {e}"))
    }

    pub fn part_files(&self) -> Vec<PathBuf> {
        list_parts(&self.downloads)
    }
}

pub fn list_parts(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.to_string_lossy().ends_with(".fetchlane-part"))
        .collect()
}

pub async fn wait_for(
    engine: &Engine,
    id: &str,
    secs: u64,
    pred: impl Fn(&DownloadView) -> bool,
) -> DownloadView {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(secs);
    loop {
        let v = engine.get(id).expect("download exists");
        if pred(&v) {
            return v;
        }
        if tokio::time::Instant::now() > deadline {
            panic!("timed out waiting; last state: {v:#?}");
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Wait until the download reaches `status` and its worker has fully exited.
pub async fn wait_status(
    engine: &Engine,
    id: &str,
    status: fetchlane_engine::Status,
    secs: u64,
) -> DownloadView {
    wait_for(engine, id, secs, |v| {
        v.status == status && v.phase.is_none()
    })
    .await
}
