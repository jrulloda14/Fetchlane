//! Queue and control behaviour required by the Fetchlane design system:
//! queue order, Pause all holding the queue, Start now, Retry now, retry
//! counts, Restart, Remove with Recycle Bin, links and settings.

mod support;

use std::sync::Arc;
use std::time::Duration;

use fetchlane_engine::{
    AddRequest, Density, Engine, ErrorKind, QueueMove, Settings, Status, Theme, Trasher,
};
use support::*;

const MB: usize = 1024 * 1024;

fn add(engine: &Engine, url: String) -> String {
    engine
        .add(AddRequest {
            url,
            ..Default::default()
        })
        .unwrap()
        .id
}

fn positions(engine: &Engine, ids: &[&str]) -> Vec<Option<u32>> {
    ids.iter()
        .map(|id| engine.get(id).unwrap().queue_position)
        .collect()
}

fn range_start(l: &Logged) -> Option<u64> {
    l.range
        .as_deref()?
        .strip_prefix("bytes=")?
        .split('-')
        .next()?
        .parse()
        .ok()
}

/// A slow, resumable file that keeps a download slot busy for a while.
fn slow_file(srv: &TestServer, path: &str, len: usize, seed: u64) -> Vec<u8> {
    let body = pattern(len, seed);
    srv.file(path, Resource::new(body.clone()));
    srv.configure(path, |r| {
        r.throttle = Some((8 * 1024, Duration::from_millis(5)))
    });
    body
}

async fn sleep_ms(ms: u64) {
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

#[tokio::test]
async fn queue_positions_moves_and_first_in_line() {
    let srv = TestServer::start().await;
    slow_file(&srv, "/a", MB, 1);
    for (i, p) in ["/b", "/c", "/d", "/e"].iter().enumerate() {
        srv.file(p, Resource::new(pattern(100_000, 10 + i as u64)));
    }
    let env = Env::new();
    let engine = env.engine(1, 1).await;
    let a = add(&engine, srv.url("/a"));
    let b = add(&engine, srv.url("/b"));
    let c = add(&engine, srv.url("/c"));
    let d = add(&engine, srv.url("/d"));
    wait_for(&engine, &a, 5, |v| v.status == Status::Downloading).await;
    assert_eq!(
        positions(&engine, &[&a, &b, &c, &d]),
        [None, Some(1), Some(2), Some(3)]
    );

    engine.move_in_queue(&d, QueueMove::Top).unwrap();
    assert_eq!(
        positions(&engine, &[&b, &c, &d]),
        [Some(2), Some(3), Some(1)]
    );
    engine.move_in_queue(&b, QueueMove::Down).unwrap();
    assert_eq!(
        positions(&engine, &[&b, &c, &d]),
        [Some(3), Some(2), Some(1)]
    );
    engine.move_in_queue(&c, QueueMove::Up).unwrap();
    assert_eq!(
        positions(&engine, &[&b, &c, &d]),
        [Some(3), Some(1), Some(2)]
    );
    // Already first: no-op. Not queued: rejected.
    engine.move_in_queue(&c, QueueMove::Up).unwrap();
    assert_eq!(positions(&engine, &[&c]), [Some(1)]);
    assert_eq!(
        engine.move_in_queue(&a, QueueMove::Top).unwrap_err().kind,
        ErrorKind::InvalidInput
    );

    // "Download" in the add dialog puts the new item first in line.
    let e = engine
        .add(AddRequest {
            url: srv.url("/e"),
            queue_first: true,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(e.queue_position, Some(1));
    assert_eq!(
        positions(&engine, &[&c, &d, &b]),
        [Some(2), Some(3), Some(4)]
    );

    // Drag and drop: c to position 3, then past the end.
    engine.move_to_position(&c, 3).unwrap();
    assert_eq!(
        positions(&engine, &[&e.id, &d, &c, &b]),
        [Some(1), Some(2), Some(3), Some(4)]
    );
    engine.move_to_position(&c, 99).unwrap();
    engine.move_to_position(&c, 2).unwrap();
    assert_eq!(
        positions(&engine, &[&e.id, &c, &d, &b]),
        [Some(1), Some(2), Some(3), Some(4)]
    );

    for id in [&a, &b, &c, &d, &e.id] {
        wait_status(&engine, id, Status::Completed, 20).await;
    }
    assert_eq!(srv.start_order(), ["/a", "/e", "/c", "/d", "/b"]);
    assert!(engine.move_to_position(&a, 1).is_err());
}

#[tokio::test]
async fn pause_all_holds_the_queue_until_resume_all() {
    let srv = TestServer::start().await;
    let body_a = slow_file(&srv, "/a", MB, 2);
    let body_b = pattern(100_000, 3);
    srv.file("/b", Resource::new(body_b.clone()));
    let env = Env::new();
    let (a, b);
    {
        let engine = env.engine(1, 1).await;
        a = add(&engine, srv.url("/a"));
        b = add(&engine, srv.url("/b"));
        wait_for(&engine, &a, 5, |v| v.downloaded > 50_000).await;
        engine.pause_all();
        wait_status(&engine, &a, Status::Paused, 5).await;
        let snap = engine.snapshot();
        assert!(snap.queue_held);
        sleep_ms(300).await;
        assert_eq!(engine.get(&b).unwrap().status, Status::Queued);
        assert!(srv.requests("/b").is_empty(), "held queue must not start");
        engine.shutdown().await;
    }
    // The hold survives a restart.
    let engine = env.engine(1, 1).await;
    assert!(engine.snapshot().queue_held);
    sleep_ms(300).await;
    assert!(srv.requests("/b").is_empty());

    engine.resume_all();
    assert!(!engine.snapshot().queue_held);
    wait_status(&engine, &a, Status::Completed, 20).await;
    wait_status(&engine, &b, Status::Completed, 20).await;
    assert_eq!(env.read("a"), body_a);
    assert_eq!(env.read("b"), body_b);
}

#[tokio::test]
async fn direct_actions_bypass_the_hold() {
    let srv = TestServer::start().await;
    let body_a = slow_file(&srv, "/a", 300_000, 4);
    slow_file(&srv, "/b", MB, 5);
    let body_c = pattern(100_000, 6);
    srv.file("/c", Resource::new(body_c.clone()));
    let env = Env::new();
    let engine = env.engine(1, 2).await;
    let a = add(&engine, srv.url("/a"));
    let b = add(&engine, srv.url("/b"));
    wait_for(&engine, &b, 5, |v| v.downloaded > 0).await;
    engine.pause_all();
    wait_status(&engine, &a, Status::Paused, 5).await;
    wait_status(&engine, &b, Status::Paused, 5).await;

    // A download added while the queue is held waits in line...
    let c = add(&engine, srv.url("/c"));
    sleep_ms(200).await;
    assert_eq!(engine.get(&c).unwrap().status, Status::Queued);

    // ...but resuming one download directly runs it despite the hold.
    engine.resume(&a).unwrap();
    wait_status(&engine, &a, Status::Completed, 20).await;
    assert_eq!(env.read("a"), body_a);
    assert_eq!(engine.get(&b).unwrap().status, Status::Paused);
    assert_eq!(engine.get(&c).unwrap().status, Status::Queued);

    // "Start now" also ignores the hold.
    engine.start_now(&c).unwrap();
    wait_status(&engine, &c, Status::Completed, 20).await;
    assert_eq!(env.read("c"), body_c);
    assert!(engine.snapshot().queue_held);
}

#[tokio::test]
async fn start_now_runs_beyond_the_limit() {
    let srv = TestServer::start().await;
    let body_a = slow_file(&srv, "/a", MB, 7);
    let body_b = slow_file(&srv, "/b", 200_000, 8);
    let env = Env::new();
    let engine = env.engine(1, 1).await;
    let a = add(&engine, srv.url("/a"));
    let b = add(&engine, srv.url("/b"));
    wait_for(&engine, &a, 5, |v| v.downloaded > 0).await;
    assert_eq!(engine.get(&b).unwrap().queue_position, Some(1));
    engine.start_now(&b).unwrap();
    wait_for(&engine, &b, 5, |v| v.status == Status::Downloading).await;
    assert_eq!(engine.get(&a).unwrap().status, Status::Downloading);
    wait_status(&engine, &b, Status::Completed, 20).await;
    wait_status(&engine, &a, Status::Completed, 20).await;
    assert_eq!(env.read("a"), body_a);
    assert_eq!(env.read("b"), body_b);
}

#[tokio::test]
async fn pause_is_refused_when_progress_would_be_lost() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 9);
    srv.file("/n", Resource::new(body.clone()).ranges(RangeMode::Ignored));
    srv.configure("/n", |r| {
        r.throttle = Some((8 * 1024, Duration::from_millis(5)))
    });
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/n"));
    let v = wait_for(&engine, &id, 5, |v| v.downloaded > 50_000).await;
    assert!(!v.can_pause);
    assert_eq!(engine.pause(&id).unwrap_err().kind, ErrorKind::CannotResume);
    // Pause all skips it and it keeps going.
    engine.pause_all();
    sleep_ms(100).await;
    assert_eq!(engine.get(&id).unwrap().status, Status::Downloading);
    wait_status(&engine, &id, Status::Completed, 20).await;
    assert_eq!(env.read("n"), body);
}

#[tokio::test]
async fn slow_disk_saves_dont_stall_transfers() {
    // Saving the download list takes longer than the read timeout, as on a
    // slow or antivirus-scanned disk. Saves must not stall the transfer:
    // this download can't resume, so a spurious "server stopped responding"
    // would end it as "Can't resume".
    let srv = TestServer::start().await;
    let body = pattern(MB / 2, 10);
    srv.file(
        "/sd",
        Resource::new(body.clone()).ranges(RangeMode::Ignored),
    );
    srv.configure("/sd", |r| {
        r.throttle = Some((8 * 1024, Duration::from_millis(5)))
    });
    let env = Env::new();
    let mut cfg = env.with_fake_bin(test_config());
    cfg.simulated_save_delay = Duration::from_millis(1_200);
    let engine = env.engine_with(cfg, 1, 3).await;
    let id = add(&engine, srv.url("/sd"));
    let done = wait_status(&engine, &id, Status::Completed, 30).await;
    assert_eq!(env.read(&done.file_name), body);
}

#[tokio::test]
async fn retry_attempts_are_reported_and_retry_now_skips_the_wait() {
    let srv = TestServer::start().await;
    let body = pattern(300_000, 11);
    srv.file("/r", Resource::new(body.clone()));
    srv.configure("/r", |r| r.drops.extend([Some(0); 10]));
    let env = Env::new();
    let mut cfg = env.with_fake_bin(test_config());
    cfg.backoff_base = Duration::from_secs(3);
    cfg.backoff_max = Duration::from_secs(3);
    let engine = env.engine_with(cfg, 1, 3).await;
    let id = add(&engine, srv.url("/r"));

    let v = wait_for(&engine, &id, 5, |v| v.retry_attempt == Some(1)).await;
    assert_eq!(v.status, Status::Downloading);
    assert_eq!(v.retry_limit, 3);
    assert!(matches!(v.retry_in_secs, Some(1..=4)), "{v:?}");
    assert!(v.error.is_none(), "never Failed while retries remain");

    let started = tokio::time::Instant::now();
    engine.retry_now(&id).unwrap();
    wait_for(&engine, &id, 5, |v| v.retry_attempt == Some(2)).await;
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "Retry now waited"
    );
    assert_eq!(srv.requests("/r").len(), 2);

    srv.configure("/r", |r| r.drops.clear());
    engine.retry_now(&id).unwrap();
    wait_status(&engine, &id, Status::Completed, 5).await;
    assert_eq!(env.read("r"), body);
}

#[tokio::test]
async fn automatic_retry_can_be_turned_off() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 12);
    srv.file("/off", Resource::new(body.clone()));
    srv.configure("/off", |r| r.drops.push_back(Some(100_000)));
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    engine
        .update_settings(Settings {
            retry_automatically: false,
            ..engine.settings()
        })
        .unwrap();
    let id = add(&engine, srv.url("/off"));
    let v = wait_status(&engine, &id, Status::Failed, 10).await;
    assert_eq!(v.error.unwrap().kind, ErrorKind::Network);
    assert_eq!(v.retry_limit, 0);
    assert_eq!(srv.requests("/off").len(), 1);
    // The partial is resumable, so Retry continues where it stopped.
    engine.retry_now(&id).unwrap();
    wait_status(&engine, &id, Status::Completed, 10).await;
    assert_eq!(env.read("off"), body);
    assert_eq!(
        range_start(srv.requests("/off").last().unwrap()),
        Some(100_000)
    );
}

#[tokio::test]
async fn restart_while_downloading_starts_over_cleanly() {
    let srv = TestServer::start().await;
    let body = slow_file(&srv, "/rs", MB, 13);
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/rs"));
    wait_for(&engine, &id, 10, |v| v.downloaded > 200_000).await;
    let before = srv.requests("/rs").len();
    engine.restart(&id).unwrap();
    wait_status(&engine, &id, Status::Completed, 30).await;
    assert_eq!(env.read("rs"), body);
    let after = srv.requests("/rs");
    assert_eq!(range_start(&after[before]), Some(0), "{after:?}");
    assert!(after[before].if_range.is_none());
    assert_eq!(engine.peak_workers_per_download(), 1);
    assert!(env.part_files().is_empty());
    assert_eq!(
        engine.restart(&id).unwrap_err().kind,
        ErrorKind::InvalidInput,
        "completed downloads can't be restarted"
    );
}

#[tokio::test]
async fn restart_from_paused_discards_partial_data() {
    let srv = TestServer::start().await;
    let body = slow_file(&srv, "/rp", MB, 14);
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/rp"));
    wait_for(&engine, &id, 10, |v| v.downloaded > 100_000).await;
    engine.pause(&id).unwrap();
    wait_status(&engine, &id, Status::Paused, 5).await;
    engine.restart(&id).unwrap();
    let v = engine.get(&id).unwrap();
    assert!(v.downloaded < 100_000, "progress was reset: {v:?}");
    wait_status(&engine, &id, Status::Completed, 30).await;
    assert_eq!(env.read("rp"), body);
}

#[tokio::test]
async fn remove_keeps_files_unless_asked_and_uses_recycle_bin() {
    let srv = TestServer::start().await;
    srv.file("/x.bin", Resource::new(pattern(50_000, 15)));
    srv.file("/y.bin", Resource::new(pattern(50_000, 16)));
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let x = add(&engine, srv.url("/x.bin"));
    let y = add(&engine, srv.url("/y.bin"));
    wait_status(&engine, &x, Status::Completed, 10).await;
    wait_status(&engine, &y, Status::Completed, 10).await;

    engine.remove(&x, false).await.unwrap();
    assert!(engine.get(&x).is_none());
    assert!(env.downloads.join("x.bin").exists(), "file kept by default");

    engine.remove(&y, true).await.unwrap();
    assert!(engine.get(&y).is_none());
    assert!(!env.downloads.join("y.bin").exists());
    assert_eq!(
        std::fs::read(env.bin.join("y.bin")).unwrap(),
        pattern(50_000, 16)
    );
}

#[tokio::test]
async fn failed_recycle_keeps_the_entry_and_the_file() {
    let srv = TestServer::start().await;
    srv.file("/z.bin", Resource::new(pattern(50_000, 17)));
    let env = Env::new();
    let mut cfg = test_config();
    cfg.trash = Trasher(Arc::new(|_| Err(std::io::Error::other("locked"))));
    let engine = env.engine_with(cfg, 1, 3).await;
    let z = add(&engine, srv.url("/z.bin"));
    wait_status(&engine, &z, Status::Completed, 10).await;
    let err = engine.remove(&z, true).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::FileSystem);
    assert!(err.message.contains("Recycle Bin"));
    assert!(engine.get(&z).is_some());
    assert!(env.downloads.join("z.bin").exists());
}

#[tokio::test]
async fn links_hide_parameters_but_full_link_is_available() {
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let raw = "http://user:pw@127.0.0.1:9/f.bin?token=abc&sig=xyz";
    let v = engine
        .add(AddRequest {
            url: raw.into(),
            start_paused: true,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(v.display_url, "http://127.0.0.1:9/f.bin");
    assert_eq!(v.hidden_params, 2);
    assert_eq!(engine.source_url(&v.id).unwrap(), raw);
}

#[tokio::test]
async fn settings_round_trip_and_are_clamped() {
    let env = Env::new();
    {
        let engine = env.engine(1, 3).await;
        let saved = engine
            .update_settings(Settings {
                theme: Theme::Dark,
                density: Density::Compact,
                retry_attempts: 50,
                retry_automatically: false,
                ask_each_time: true,
                keep_history: false,
                max_concurrent: 0,
                ..engine.settings()
            })
            .unwrap();
        assert_eq!(saved.retry_attempts, Settings::MAX_RETRY_ATTEMPTS);
        assert_eq!(saved.max_concurrent, 1);
        engine.shutdown().await;
    }
    let raw: serde_json::Value =
        serde_json::from_slice(&std::fs::read(env.state_dir.join("settings.json")).unwrap())
            .unwrap();
    assert_eq!(raw["theme"], "dark");
    assert_eq!(raw["density"], "compact");
    let engine = Engine::open(&env.state_dir, test_config()).await.unwrap();
    let s = engine.settings();
    assert_eq!(s.theme, Theme::Dark);
    assert_eq!(s.density, Density::Compact);
    assert_eq!(s.retry_attempts, 10);
    assert!(!s.retry_automatically && s.ask_each_time && !s.keep_history);
    assert!(Engine::free_space(&env.downloads).is_some_and(|b| b > 0));
}

#[tokio::test]
async fn completed_downloads_are_forgotten_when_history_is_off() {
    let srv = TestServer::start().await;
    srv.file("/h.bin", Resource::new(pattern(50_000, 18)));
    let env = Env::new();
    let id;
    {
        let engine = env.engine(1, 3).await;
        engine
            .update_settings(Settings {
                keep_history: false,
                ..engine.settings()
            })
            .unwrap();
        id = add(&engine, srv.url("/h.bin"));
        wait_status(&engine, &id, Status::Completed, 10).await;
        // Still shown for the rest of the session.
        assert!(engine.get(&id).is_some());
        engine.shutdown().await;
    }
    let engine = env.engine(1, 3).await;
    assert!(engine.get(&id).is_none());
    assert!(
        env.downloads.join("h.bin").exists(),
        "the file itself stays"
    );
}
