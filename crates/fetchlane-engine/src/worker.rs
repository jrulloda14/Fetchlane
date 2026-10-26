//! The transfer worker for one download: requests, range validation,
//! streaming writes, checkpoints, retries and finalization.

use std::cmp::min;
use std::fs as stdfs;
use std::io::{self, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use reqwest::header;
use reqwest::Response;
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncSeekExt, AsyncWriteExt, BufWriter};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::engine::{part_path, Inner, Live, Outcome};
use crate::error::{DownloadError, ErrorKind};
use crate::filename;
use crate::http::{self, content_length, content_range, validators};
use crate::model::{DownloadRecord, Layout, Phase, Segment, Validators};
use crate::redact::redact_url;

const WRITE_BUFFER: usize = 256 * 1024;
/// Restarts from zero (changed resource, broken ranges) before giving up.
const MAX_RESTARTS: u32 = 3;

/// Why an attempt ended early.
#[derive(Debug)]
enum Halt {
    /// Asked to stop (pause, cancel, shutdown). Not an error.
    Stop,
    Fail(DownloadError),
    /// The resource no longer matches the data we have.
    Changed,
    /// The server's range responses can't be trusted.
    RangesUnreliable,
}

impl Halt {
    fn severity(&self) -> u8 {
        match self {
            Halt::Stop => 0,
            Halt::Fail(_) => 1,
            Halt::RangesUnreliable => 2,
            Halt::Changed => 3,
        }
    }
}

fn io_fail(e: io::Error) -> Halt {
    Halt::Fail(DownloadError::from_io(&e))
}

/// One contiguous range of the output file and its progress.
pub(crate) struct Slot {
    start: u64,
    /// Exclusive end; `None` for a single stream of possibly unknown size.
    end: Option<u64>,
    /// Bytes written from `start` (may still be buffered).
    done: AtomicU64,
    /// Bytes from `start` that are flushed and fsync'd.
    checkpoint: AtomicU64,
}

impl Slot {
    fn new(start: u64, end: Option<u64>, done: u64) -> Self {
        Self {
            start,
            end,
            done: AtomicU64::new(done),
            checkpoint: AtomicU64::new(done),
        }
    }

    fn done(&self) -> u64 {
        self.done.load(Ordering::SeqCst)
    }

    fn remaining(&self) -> Option<u64> {
        self.end.map(|e| e - self.start - self.done())
    }
}

pub(crate) struct Plan {
    segmented: bool,
    slots: Vec<Slot>,
}

impl Plan {
    fn single(checkpoint: u64) -> Self {
        Self {
            segmented: false,
            slots: vec![Slot::new(0, None, checkpoint)],
        }
    }

    fn segmented(ranges: &[(u64, u64)]) -> Self {
        Self {
            segmented: true,
            slots: ranges
                .iter()
                .map(|&(s, e)| Slot::new(s, Some(e), 0))
                .collect(),
        }
    }

    fn from_layout(layout: &Layout) -> Self {
        match layout {
            Layout::Single { checkpoint } => Self::single(*checkpoint),
            Layout::Segmented { segments } => Self {
                segmented: true,
                slots: segments
                    .iter()
                    .map(|s| Slot::new(s.start, Some(s.end), s.done))
                    .collect(),
            },
        }
    }

    fn layout(&self) -> Layout {
        if self.segmented {
            Layout::Segmented {
                segments: self
                    .slots
                    .iter()
                    .map(|s| Segment {
                        start: s.start,
                        end: s.end.expect("segments always have an end"),
                        done: s.checkpoint.load(Ordering::SeqCst),
                    })
                    .collect(),
            }
        } else {
            Layout::Single {
                checkpoint: self.slots[0].checkpoint.load(Ordering::SeqCst),
            }
        }
    }

    fn checkpointed(&self) -> u64 {
        self.slots
            .iter()
            .map(|s| s.checkpoint.load(Ordering::SeqCst))
            .sum()
    }

    fn written(&self) -> u64 {
        self.slots.iter().map(Slot::done).sum()
    }

    /// Discard unconfirmed progress; the next attempt resumes from checkpoints.
    fn rewind(&self) {
        for s in &self.slots {
            s.done
                .store(s.checkpoint.load(Ordering::SeqCst), Ordering::SeqCst);
        }
    }
}

struct Job {
    id: String,
    url: String,
    dest_dir: PathBuf,
    file_name: String,
    part: PathBuf,
    total: Option<u64>,
    validators: Validators,
    resumable: bool,
    ranges_unreliable: bool,
    connections: u8,
    plan: Arc<Plan>,
}

impl Job {
    fn new(rec: DownloadRecord, connections: u8) -> Self {
        Self {
            part: part_path(&rec),
            plan: Arc::new(Plan::from_layout(&rec.layout)),
            id: rec.id,
            url: rec.url,
            dest_dir: rec.dest_dir,
            file_name: rec.file_name,
            total: rec.total_size,
            validators: rec.validators,
            resumable: rec.resumable,
            ranges_unreliable: rec.ranges_unreliable,
            connections,
        }
    }

    fn can_resume(&self) -> bool {
        self.resumable
            && !self.ranges_unreliable
            && self.total.is_some()
            && self.validators.if_range().is_some()
    }

    /// Forget everything learned about the resource and its data.
    fn reset(&mut self) {
        self.total = None;
        self.validators = Validators::default();
        self.resumable = false;
        self.plan = Arc::new(Plan::single(0));
    }
}

#[derive(Clone)]
struct Ctx {
    inner: Arc<Inner>,
    live: Arc<Live>,
    id: Arc<str>,
    safe_url: Arc<str>,
}

impl Ctx {
    /// Copy everything the worker knows into the persisted record.
    fn publish(&self, job: &Job) {
        let layout = job.plan.layout();
        self.inner.update_record(&self.id, |r| {
            r.total_size = job.total;
            r.validators = job.validators.clone();
            r.resumable = job.resumable;
            r.ranges_unreliable = job.ranges_unreliable;
            r.layout = layout;
        });
        self.inner.persist_soon();
    }

    fn publish_plan(&self, plan: &Plan) {
        let layout = plan.layout();
        self.inner.update_record(&self.id, |r| r.layout = layout);
        self.inner.persist_soon();
    }

    /// Publish and write to disk before any new data is written, so stale
    /// metadata can never describe new bytes after a crash.
    fn commit(&self, job: &Job) {
        self.publish(job);
        self.inner.persist_now();
    }

    async fn send(
        &self,
        token: &CancellationToken,
        url: &str,
        range: Option<String>,
        if_range: Option<&str>,
    ) -> Result<Response, Halt> {
        let mut req = self
            .inner
            .client
            .get(url)
            .header(header::ACCEPT_ENCODING, "identity");
        if let Some(r) = range {
            req = req.header(header::RANGE, r);
            if let Some(v) = if_range {
                req = req.header(header::IF_RANGE, v);
            }
        }
        let fut = tokio::time::timeout(self.inner.cfg.response_timeout, req.send());
        tokio::select! {
            biased;
            _ = token.cancelled() => Err(Halt::Stop),
            r = fut => match r {
                Err(_) => Err(Halt::Fail(DownloadError::timeout())),
                Ok(Err(e)) => Err(Halt::Fail(DownloadError::from_reqwest(&e))),
                Ok(Ok(resp)) => Ok(resp),
            },
        }
    }
}

/// Counts an open connection for display while alive.
struct ConnGuard(Arc<Live>);

impl ConnGuard {
    fn new(live: &Arc<Live>) -> Self {
        live.connections.fetch_add(1, Ordering::Relaxed);
        Self(live.clone())
    }
}

impl Drop for ConnGuard {
    fn drop(&mut self) {
        self.0.connections.fetch_sub(1, Ordering::Relaxed);
    }
}

/// Per-run options taken from the settings when the download starts.
#[derive(Debug, Clone, Copy)]
pub(crate) struct RunOptions {
    pub connections: u8,
    /// Automatic retries allowed; 0 disables automatic retry.
    pub retry_limit: u32,
}

pub(crate) async fn run(
    inner: Arc<Inner>,
    rec: DownloadRecord,
    live: Arc<Live>,
    opts: RunOptions,
) -> Outcome {
    let ctx = Ctx {
        safe_url: redact_url(&rec.url).into(),
        id: rec.id.clone().into(),
        inner,
        live,
    };
    let mut job = Job::new(rec, opts.connections);
    let mut failures = 0u32;
    let mut restarts = 0u32;
    tracing::info!(id = %ctx.id, url = %ctx.safe_url, "download starting");

    loop {
        ctx.live.set_retry_at(None);
        ctx.live.retry_attempt.store(0, Ordering::Relaxed);
        ctx.live.set_phase(Phase::Connecting);
        ctx.inner.notify_changed();
        job.plan.rewind();
        ctx.live.bytes.store(job.plan.written(), Ordering::SeqCst);
        let before = job.plan.checkpointed();

        let halt = match attempt(&ctx, &mut job).await {
            Ok(()) => {
                ctx.live.set_phase(Phase::Finalizing);
                ctx.inner.notify_changed();
                return match finalize(&job).await {
                    Ok((file_name, size)) => Outcome::Completed { file_name, size },
                    Err(e) => Outcome::Failed(e),
                };
            }
            Err(h) => h,
        };
        if ctx.live.cancel.is_cancelled() {
            return Outcome::Stopped;
        }
        match halt {
            Halt::Stop => return Outcome::Stopped,
            Halt::Changed | Halt::RangesUnreliable if before > 0 => {
                // Starting over would throw away progress saved by an earlier
                // attempt or run. Keep the partial file and leave that
                // decision to the user (Restart). Data from this attempt
                // alone is downloaded again automatically.
                let changed = matches!(halt, Halt::Changed);
                if changed {
                    tracing::info!(id = %ctx.id, "file changed on the server; partial data kept until restart");
                } else {
                    tracing::warn!(id = %ctx.id, "server range responses were inconsistent; partial data kept until restart");
                    job.ranges_unreliable = true;
                }
                job.resumable = false;
                ctx.publish(&job);
                return Outcome::Failed(restart_needed(changed));
            }
            Halt::Changed | Halt::RangesUnreliable => {
                // No earlier progress, so starting over loses nothing saved.
                restarts += 1;
                if restarts > MAX_RESTARTS {
                    return Outcome::Failed(DownloadError::new(
                        ErrorKind::ResourceChanged,
                        "The file kept changing on the server while downloading.",
                    ));
                }
                if matches!(halt, Halt::RangesUnreliable) {
                    tracing::warn!(id = %ctx.id, "server range responses were inconsistent; using a single connection without resume");
                    job.ranges_unreliable = true;
                } else {
                    tracing::info!(id = %ctx.id, "file changed on the server; restarting from the beginning");
                }
                job.reset();
                ctx.commit(&job);
            }
            Halt::Fail(err) => {
                if job.plan.checkpointed() > before {
                    failures = 0;
                }
                if err.retryable && job.plan.checkpointed() > 0 && !job.can_resume() {
                    // Retrying would silently throw the partial data away;
                    // that decision belongs to the user (Restart).
                    ctx.publish(&job);
                    return Outcome::Failed(DownloadError::new(
                        ErrorKind::CannotResume,
                        format!(
                            "{} The server can't continue a partial download. Restart to download it again.",
                            err.message
                        ),
                    ));
                }
                failures += 1;
                if !err.retryable || failures > opts.retry_limit {
                    return Outcome::Failed(err);
                }
                let delay = backoff(&ctx.inner.cfg, failures, err.retry_after);
                tracing::info!(id = %ctx.id, attempt = failures, delay_ms = delay.as_millis() as u64, "retrying: {}", err.message);
                ctx.publish(&job);
                ctx.live.set_phase(Phase::Retrying);
                ctx.live.retry_attempt.store(failures, Ordering::Relaxed);
                ctx.live.set_retry_at(Some(Instant::now() + delay));
                ctx.inner.notify_changed();
                tokio::select! {
                    _ = ctx.live.cancel.cancelled() => return Outcome::Stopped,
                    _ = tokio::time::sleep(delay) => {}
                    _ = ctx.live.retry_wake.notified() => {}
                }
            }
        }
    }
}

/// The partial data can't be continued; only an explicit restart can go on.
fn restart_needed(changed: bool) -> DownloadError {
    DownloadError::new(
        ErrorKind::CannotResume,
        if changed {
            "The file changed on the server since this download started, so the partial data can't be continued. Restart to download it again."
        } else {
            "The server didn't send the rest of the file reliably, so the partial data can't be continued. Restart to download it again."
        },
    )
}

/// The partial file on disk doesn't match what was saved about it.
fn partial_mismatch() -> Halt {
    Halt::Fail(DownloadError::new(
        ErrorKind::CannotResume,
        "The partial file doesn't match this download, so it can't be continued. Restart to download it again.",
    ))
}

/// Delay before automatic retry number `failures` (1-based): the base,
/// tripled for each further attempt, capped, with +/-20% jitter. A server's
/// `Retry-After` is honored up to the cap.
fn backoff(cfg: &crate::EngineConfig, failures: u32, retry_after: Option<Duration>) -> Duration {
    let exp = cfg
        .backoff_base
        .saturating_mul(3u32.saturating_pow(failures.saturating_sub(1).min(16)));
    let base = min(exp, cfg.backoff_max).mul_f64(0.8 + fastrand::f64() * 0.4);
    match retry_after {
        Some(ra) => base.max(min(ra, cfg.backoff_max)),
        None => base,
    }
}

async fn attempt(ctx: &Ctx, job: &mut Job) -> Result<(), Halt> {
    if !job.dest_dir.is_dir() {
        return Err(Halt::Fail(DownloadError::destination_unavailable()));
    }
    if job.plan.checkpointed() > 0 && !job.can_resume() {
        // The partial data can't be continued. Keep it and let the user
        // decide to restart, rather than silently starting over.
        return Err(Halt::Fail(DownloadError::cannot_resume()));
    }
    if job.plan.segmented {
        resume_segmented(ctx, job).await
    } else if job.plan.checkpointed() > 0 {
        resume_single(ctx, job).await
    } else {
        fresh(ctx, job).await
    }
}

fn ensure_space(dir: &Path, needed: u64) -> Result<(), Halt> {
    match fs4::available_space(dir) {
        Ok(available) if available < needed => Err(Halt::Fail(DownloadError::disk_full())),
        _ => Ok(()),
    }
}

/// Start from byte zero. A `Range: bytes=0-` request doubles as a probe for
/// range support without an extra round trip.
async fn fresh(ctx: &Ctx, job: &mut Job) -> Result<(), Halt> {
    let token = ctx.live.cancel.clone();
    let try_range = !job.ranges_unreliable;
    let mut resp = ctx
        .send(
            &token,
            &job.url,
            try_range.then(|| "bytes=0-".to_string()),
            None,
        )
        .await?;
    if try_range && resp.status().as_u16() == 416 {
        // Some servers reject ranges on empty or dynamic resources.
        resp = ctx.send(&token, &job.url, None, None).await?;
    }
    let status = resp.status().as_u16();
    let headers = resp.headers().clone();
    match status {
        206 if try_range => {
            let total = match content_range(&headers) {
                Some(cr) if cr.start == 0 && cr.total == Some(cr.end + 1) => cr.end + 1,
                _ => return Err(Halt::RangesUnreliable),
            };
            if content_length(&headers).is_some_and(|len| len != total) {
                return Err(Halt::RangesUnreliable);
            }
            job.total = Some(total);
            job.validators = validators(&headers);
            // Resuming is only safe if we can prove the resource is unchanged.
            job.resumable = job.validators.if_range().is_some();
            ensure_space(&job.dest_dir, total)?;
            let n = if job.resumable {
                segment_count(total, job.connections, ctx.inner.cfg.min_segment_size)
            } else {
                1
            };
            if n > 1 {
                segmented_fresh(ctx, job, resp, n).await
            } else {
                single_stream(ctx, job, resp, 0).await
            }
        }
        200..=299 if status != 206 => {
            job.total = content_length(&headers);
            job.validators = validators(&headers);
            job.resumable = false;
            if let Some(total) = job.total {
                ensure_space(&job.dest_dir, total)?;
            }
            single_stream(ctx, job, resp, 0).await
        }
        _ => Err(Halt::Fail(DownloadError::from_status(
            status,
            http::retry_after(&headers),
        ))),
    }
}

async fn resume_single(ctx: &Ctx, job: &mut Job) -> Result<(), Halt> {
    let on_disk = match tokio::fs::metadata(&job.part).await {
        Ok(m) => m.len(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => 0,
        Err(e) => return Err(io_fail(e)),
    };
    let have = min(job.plan.checkpointed(), on_disk);
    let total = job.total.expect("can_resume requires a known size");
    if have > total {
        return Err(partial_mismatch());
    }
    if have == 0 {
        // The partial file is gone; nothing is lost by starting over.
        job.reset();
        ctx.commit(job);
        return fresh(ctx, job).await;
    }
    if have == total {
        job.plan = Arc::new(Plan::single(total));
        let mut f = open_single(&job.part, total).await.map_err(io_fail)?;
        f.flush().await.map_err(io_fail)?;
        return Ok(());
    }
    ensure_space(&job.dest_dir, total - have)?;
    let token = ctx.live.cancel.clone();
    let resp = ctx
        .send(
            &token,
            &job.url,
            Some(format!("bytes={have}-")),
            job.validators.if_range(),
        )
        .await?;
    match resp.status().as_u16() {
        206 => {
            check_partial_response(&resp, have, total - 1, total, &job.validators)?;
            tracing::info!(id = %ctx.id, offset = have, "resuming");
            single_stream(ctx, job, resp, have).await
        }
        200 => {
            // Range ignored, or If-Range failed because the file changed.
            // Using this reply would overwrite the partial data, so stop and
            // keep it; the run loop asks the user to restart.
            let headers = resp.headers();
            let changed = http::validators_changed(&job.validators, &validators(headers))
                || content_length(headers).is_some_and(|len| len != total);
            Err(if changed {
                Halt::Changed
            } else {
                Halt::RangesUnreliable
            })
        }
        416 => Err(Halt::Changed),
        s => Err(Halt::Fail(DownloadError::from_status(
            s,
            http::retry_after(resp.headers()),
        ))),
    }
}

/// Check a 206 answer to `bytes=start-end` against what we asked for and
/// the version of the resource we already have.
fn check_partial_response(
    resp: &Response,
    start: u64,
    end: u64,
    total: u64,
    known: &Validators,
) -> Result<(), Halt> {
    let headers = resp.headers();
    if http::validators_changed(known, &validators(headers)) {
        return Err(Halt::Changed);
    }
    match content_range(headers) {
        Some(cr) if cr.start == start && cr.end == end && cr.total == Some(total) => {}
        Some(cr) if cr.total.is_some_and(|t| t != total) => return Err(Halt::Changed),
        _ => return Err(Halt::RangesUnreliable),
    }
    if content_length(headers).is_some_and(|len| len != end - start + 1) {
        return Err(Halt::RangesUnreliable);
    }
    Ok(())
}

async fn open_single(part: &Path, offset: u64) -> io::Result<File> {
    let mut f = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(part)
        .await?;
    let len = f.metadata().await?.len();
    if len < offset {
        return Err(io::Error::other(
            "partial file is shorter than its checkpoint",
        ));
    }
    if len > offset {
        f.set_len(offset).await?;
    }
    f.seek(SeekFrom::Start(offset)).await?;
    Ok(f)
}

/// Stream `resp` sequentially into the partial file starting at `offset`.
async fn single_stream(ctx: &Ctx, job: &mut Job, resp: Response, offset: u64) -> Result<(), Halt> {
    job.plan = Arc::new(Plan::single(offset));
    ctx.commit(job);
    let file = open_single(&job.part, offset).await.map_err(io_fail)?;
    ctx.live.bytes.store(offset, Ordering::SeqCst);
    let _conn = ConnGuard::new(&ctx.live);
    let plan = job.plan.clone();
    let slot = &plan.slots[0];
    let mut w = BufWriter::with_capacity(WRITE_BUFFER, file);
    let limit = job.total.map(|t| t.saturating_sub(offset));
    let token = ctx.live.cancel.clone();
    let copied = copy_body(ctx, resp, &mut w, limit, slot, &token, &plan).await;
    let synced = checkpoint(&mut w, slot).await;
    ctx.publish_plan(&plan);
    copied?;
    synced.map_err(io_fail)?;
    match job.total {
        Some(total) if slot.done() != total => Err(Halt::Fail(DownloadError::interrupted())),
        Some(_) => Ok(()),
        None => {
            // Unknown length: the stream ended cleanly, so that's the size.
            job.total = Some(slot.done());
            ctx.publish(job);
            Ok(())
        }
    }
}

fn segment_count(total: u64, connections: u8, min_segment: u64) -> usize {
    if connections <= 1 || min_segment == 0 {
        return 1;
    }
    (total / min_segment).clamp(1, connections as u64) as usize
}

fn split_ranges(total: u64, n: usize) -> Vec<(u64, u64)> {
    let n = n as u64;
    let base = total / n;
    (0..n)
        .map(|i| (i * base, if i == n - 1 { total } else { (i + 1) * base }))
        .collect()
}

async fn segmented_fresh(ctx: &Ctx, job: &mut Job, first: Response, n: usize) -> Result<(), Halt> {
    let total = job.total.expect("segmented downloads have a known size");
    {
        let f = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&job.part)
            .await
            .map_err(io_fail)?;
        f.set_len(total).await.map_err(io_fail)?;
        f.sync_all().await.map_err(io_fail)?;
    }
    job.plan = Arc::new(Plan::segmented(&split_ranges(total, n)));
    ctx.commit(job);
    tracing::info!(id = %ctx.id, segments = n, "downloading with multiple connections");
    run_segments(ctx, job, Some(first)).await
}

async fn resume_segmented(ctx: &Ctx, job: &mut Job) -> Result<(), Halt> {
    let len = tokio::fs::metadata(&job.part).await.map(|m| m.len()).ok();
    if job.total.is_none() || len != job.total {
        if len.is_some() && job.plan.checkpointed() > 0 {
            return Err(partial_mismatch());
        }
        job.reset();
        ctx.commit(job);
        return fresh(ctx, job).await;
    }
    run_segments(ctx, job, None).await
}

struct SegmentJob {
    url: String,
    part: PathBuf,
    total: u64,
    validators: Validators,
}

async fn run_segments(ctx: &Ctx, job: &Job, mut first: Option<Response>) -> Result<(), Halt> {
    let plan = job.plan.clone();
    let sj = Arc::new(SegmentJob {
        url: job.url.clone(),
        part: job.part.clone(),
        total: job.total.expect("segmented downloads have a known size"),
        validators: job.validators.clone(),
    });
    let token = ctx.live.cancel.child_token();
    let mut set = JoinSet::new();
    for i in 0..plan.slots.len() {
        // The initial response starts at byte 0, so it belongs to slot 0.
        let initial = if i == 0 { first.take() } else { None };
        if plan.slots[i].remaining() == Some(0) {
            continue;
        }
        set.spawn(segment_task(
            ctx.clone(),
            sj.clone(),
            plan.clone(),
            i,
            initial,
            token.clone(),
        ));
    }
    // Wait for every writer before returning, so nothing writes after we
    // report a result.
    let mut worst: Option<Halt> = None;
    while let Some(joined) = set.join_next().await {
        let result = joined.unwrap_or_else(|e| {
            Err(Halt::Fail(DownloadError::internal(format!(
                "segment failed: {e}"
            ))))
        });
        if let Err(h) = result {
            if worst.as_ref().is_none_or(|w| h.severity() > w.severity()) {
                if !matches!(h, Halt::Stop) {
                    token.cancel();
                }
                worst = Some(h);
            }
        }
    }
    ctx.publish_plan(&plan);
    if ctx.live.cancel.is_cancelled() {
        return Err(Halt::Stop);
    }
    if let Some(h) = worst {
        return Err(h);
    }
    if plan.slots.iter().any(|s| s.remaining() != Some(0)) {
        return Err(Halt::Fail(DownloadError::interrupted()));
    }
    Ok(())
}

async fn segment_task(
    ctx: Ctx,
    sj: Arc<SegmentJob>,
    plan: Arc<Plan>,
    index: usize,
    initial: Option<Response>,
    token: CancellationToken,
) -> Result<(), Halt> {
    let slot = &plan.slots[index];
    let end = slot.end.expect("segments always have an end");
    let pos = slot.start + slot.done();
    let resp = match initial {
        Some(r) => r,
        None => {
            let r = ctx
                .send(
                    &token,
                    &sj.url,
                    Some(format!("bytes={pos}-{}", end - 1)),
                    sj.validators.if_range(),
                )
                .await?;
            match r.status().as_u16() {
                206 => check_partial_response(&r, pos, end - 1, sj.total, &sj.validators)?,
                200 => {
                    let got = validators(r.headers());
                    let changed = http::validators_changed(&sj.validators, &got)
                        || content_length(r.headers()).is_some_and(|l| l != sj.total);
                    return Err(if changed {
                        Halt::Changed
                    } else {
                        Halt::RangesUnreliable
                    });
                }
                416 => return Err(Halt::Changed),
                s => {
                    return Err(Halt::Fail(DownloadError::from_status(
                        s,
                        http::retry_after(r.headers()),
                    )))
                }
            }
            r
        }
    };
    let _conn = ConnGuard::new(&ctx.live);
    let mut f = OpenOptions::new()
        .write(true)
        .open(&sj.part)
        .await
        .map_err(io_fail)?;
    f.seek(SeekFrom::Start(pos)).await.map_err(io_fail)?;
    let mut w = BufWriter::with_capacity(WRITE_BUFFER, f);
    let copied = copy_body(&ctx, resp, &mut w, Some(end - pos), slot, &token, &plan).await;
    let synced = checkpoint(&mut w, slot).await;
    copied?;
    synced.map_err(io_fail)?;
    Ok(())
}

async fn checkpoint(w: &mut BufWriter<File>, slot: &Slot) -> io::Result<()> {
    w.flush().await?;
    w.get_ref().sync_data().await?;
    slot.checkpoint.store(slot.done(), Ordering::SeqCst);
    Ok(())
}

/// Copy the response body into `w`, accepting at most `limit` bytes.
/// Returns an error if the body ends before `limit` bytes arrived.
async fn copy_body(
    ctx: &Ctx,
    mut resp: Response,
    w: &mut BufWriter<File>,
    limit: Option<u64>,
    slot: &Slot,
    token: &CancellationToken,
    plan: &Plan,
) -> Result<(), Halt> {
    let cfg = &ctx.inner.cfg;
    let mut remaining = limit;
    let mut since_checkpoint = 0u64;
    let mut last_checkpoint = Instant::now();
    ctx.live.set_phase(Phase::Transferring);
    loop {
        if remaining == Some(0) {
            return Ok(());
        }
        let next = tokio::select! {
            biased;
            _ = token.cancelled() => return Err(Halt::Stop),
            c = resp.chunk() => c,
        };
        let chunk = match next {
            Ok(Some(c)) => c,
            Ok(None) if remaining.is_some() => {
                return Err(Halt::Fail(DownloadError::interrupted()))
            }
            Ok(None) => return Ok(()),
            Err(e) => return Err(Halt::Fail(DownloadError::from_reqwest(&e))),
        };
        let take = remaining.map_or(chunk.len(), |r| min(r, chunk.len() as u64) as usize);
        w.write_all(&chunk[..take]).await.map_err(io_fail)?;
        slot.done.fetch_add(take as u64, Ordering::SeqCst);
        ctx.live.bytes.fetch_add(take as u64, Ordering::Relaxed);
        if let Some(r) = remaining.as_mut() {
            *r -= take as u64;
        }
        since_checkpoint += take as u64;
        if since_checkpoint >= cfg.checkpoint_bytes
            || last_checkpoint.elapsed() >= cfg.checkpoint_interval
        {
            checkpoint(w, slot).await.map_err(io_fail)?;
            ctx.publish_plan(plan);
            since_checkpoint = 0;
            last_checkpoint = Instant::now();
        }
    }
}

/// Verify the partial file and move it to a free final name.
async fn finalize(job: &Job) -> Result<(String, u64), DownloadError> {
    let size = tokio::fs::metadata(&job.part)
        .await
        .map_err(|e| DownloadError::from_io(&e))?
        .len();
    if job.total.is_some_and(|t| t != size) {
        return Err(DownloadError::new(
            ErrorKind::FileSystem,
            "The downloaded data didn't match the expected size. Retry to download it again.",
        ));
    }
    let dir = job.dest_dir.clone();
    let name = job.file_name.clone();
    let part = job.part.clone();
    let name = tokio::task::spawn_blocking(move || move_into_place(&dir, &name, &part))
        .await
        .map_err(|e| DownloadError::internal(format!("finalizing failed: {e}")))?
        .map_err(|e| DownloadError::from_io(&e))?;
    tracing::info!(id = %job.id, "file saved");
    Ok((name, size))
}

/// Claim a name that doesn't exist yet (atomically, via `create_new`) and
/// rename the partial file over that placeholder. Never overwrites a file
/// the user already has.
fn move_into_place(dir: &Path, name: &str, part: &Path) -> io::Result<String> {
    for n in 0..10_000u32 {
        let candidate = if n == 0 {
            name.to_string()
        } else {
            filename::numbered(name, n)
        };
        let target = dir.join(&candidate);
        match stdfs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(placeholder) => {
                drop(placeholder);
                let mut result = stdfs::rename(part, &target);
                for delay in [50, 150, 400] {
                    if result.is_ok() {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(delay));
                    result = stdfs::rename(part, &target);
                }
                return match result {
                    Ok(()) => Ok(candidate),
                    Err(e) => {
                        let _ = stdfs::remove_file(&target);
                        Err(e)
                    }
                };
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::other("no free file name found"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_follows_the_documented_schedule() {
        let cfg = crate::EngineConfig::default();
        let secs: Vec<f64> = (1..=5)
            .map(|n| backoff(&cfg, n, None).as_secs_f64())
            .collect();
        for (got, want) in secs.iter().zip([5.0, 15.0, 45.0, 120.0, 120.0]) {
            assert!((got / want - 1.0).abs() <= 0.2 + 1e-9, "{secs:?}");
        }
        let ra = backoff(&cfg, 1, Some(Duration::from_secs(60))).as_secs();
        assert_eq!(ra, 60);
    }

    #[test]
    fn segment_planning() {
        assert_eq!(segment_count(100, 1, 10), 1);
        assert_eq!(segment_count(100, 4, 10), 4);
        assert_eq!(segment_count(25, 4, 10), 2);
        assert_eq!(segment_count(5, 4, 10), 1);
        let r = split_ranges(10, 3);
        assert_eq!(r, vec![(0, 3), (3, 6), (6, 10)]);
        assert_eq!(r.iter().map(|(s, e)| e - s).sum::<u64>(), 10);
    }

    #[test]
    fn plan_layout_reports_only_checkpoints() {
        let plan = Plan::segmented(&[(0, 10), (10, 20)]);
        plan.slots[0].done.store(7, Ordering::SeqCst);
        plan.slots[0].checkpoint.store(4, Ordering::SeqCst);
        assert_eq!(plan.checkpointed(), 4);
        assert_eq!(plan.written(), 7);
        plan.rewind();
        assert_eq!(plan.written(), 4);
    }

    #[test]
    fn final_name_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        stdfs::write(dir.path().join("a.bin"), b"user file").unwrap();
        let part = dir.path().join("a.bin.x.fetchlane-part");
        stdfs::write(&part, b"new").unwrap();
        let name = move_into_place(dir.path(), "a.bin", &part).unwrap();
        assert_eq!(name, "a (1).bin");
        assert_eq!(stdfs::read(dir.path().join("a.bin")).unwrap(), b"user file");
        assert_eq!(stdfs::read(dir.path().join("a (1).bin")).unwrap(), b"new");
        assert!(!part.exists());
    }
}
