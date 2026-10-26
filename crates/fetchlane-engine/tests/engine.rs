//! End-to-end engine tests against the deterministic local server.

mod support;

use std::time::Duration;

use fetchlane_engine::{AddRequest, ErrorKind, Status};
use support::*;

const MB: usize = 1024 * 1024;

fn add(engine: &fetchlane_engine::Engine, url: String) -> String {
    engine
        .add(AddRequest {
            url,
            ..Default::default()
        })
        .unwrap()
        .id
}

fn add_named(engine: &fetchlane_engine::Engine, url: String, name: &str) -> String {
    engine
        .add(AddRequest {
            url,
            file_name: Some(name.into()),
            ..Default::default()
        })
        .unwrap()
        .id
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

#[tokio::test]
async fn normal_download_is_byte_exact() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 1);
    srv.file("/file.bin", Resource::new(body.clone()));
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/file.bin"));
    let v = wait_status(&engine, &id, Status::Completed, 10).await;
    assert_eq!(v.file_name, "file.bin");
    assert_eq!(v.total_size, Some(MB as u64));
    assert_eq!(v.downloaded, MB as u64);
    assert_eq!(env.read("file.bin"), body);
    assert!(env.part_files().is_empty());
    assert_eq!(
        engine.completed_file(&id).unwrap(),
        env.downloads.join("file.bin")
    );
}

#[tokio::test]
async fn dropped_connection_resumes_with_validated_range() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 2);
    srv.file("/f.bin", Resource::new(body.clone()));
    srv.configure("/f.bin", |r| r.drops.push_back(Some(300_000)));
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/f.bin"));
    wait_status(&engine, &id, Status::Completed, 10).await;
    assert_eq!(env.read("f.bin"), body);
    let reqs = srv.requests("/f.bin");
    assert_eq!(reqs.len(), 2, "{reqs:?}");
    let resumed_at = range_start(&reqs[1]).unwrap();
    assert!(
        resumed_at > 0 && resumed_at <= 300_000,
        "resumed at {resumed_at}"
    );
    assert_eq!(reqs[1].if_range.as_deref(), Some("\"v1\""));
    // Only the missing part was transferred again.
    assert_eq!(srv.bytes_sent("/f.bin"), 300_000 + (MB as u64 - resumed_at));
}

#[tokio::test]
async fn pause_and_resume_continue_from_checkpoint() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 3);
    srv.file("/p.bin", Resource::new(body.clone()));
    srv.configure("/p.bin", |r| {
        r.throttle = Some((8 * 1024, Duration::from_millis(5)))
    });
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/p.bin"));
    wait_for(&engine, &id, 10, |v| v.downloaded > 150_000).await;
    engine.pause(&id).unwrap();
    let paused = wait_status(&engine, &id, Status::Paused, 10).await;
    // Persisted progress matches the bytes on disk exactly.
    let part = env.part_files();
    assert_eq!(part.len(), 1);
    assert_eq!(
        std::fs::metadata(&part[0]).unwrap().len(),
        paused.downloaded
    );
    assert!(paused.downloaded < MB as u64);
    engine.resume(&id).unwrap();
    wait_status(&engine, &id, Status::Completed, 20).await;
    assert_eq!(env.read("p.bin"), body);
    let last = srv.requests("/p.bin").last().cloned().unwrap();
    assert_eq!(range_start(&last), Some(paused.downloaded));
}

#[tokio::test]
async fn server_that_stops_honoring_ranges_is_handled() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 5);
    srv.file(
        "/s.bin",
        Resource::new(body.clone()).ranges(RangeMode::IgnoredAfterFirst),
    );
    srv.configure("/s.bin", |r| r.drops.push_back(Some(300_000)));
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/s.bin"));
    wait_status(&engine, &id, Status::Completed, 10).await;
    let reqs = srv.requests("/s.bin");
    assert!(
        range_start(&reqs[1]).unwrap() > 0,
        "second request asked for a range"
    );
    // The 200 reply replaced the partial data instead of being appended.
    assert_eq!(env.read("s.bin"), body);
}

#[tokio::test]
async fn changed_resource_detected_via_if_range() {
    let srv = TestServer::start().await;
    let old = pattern(MB, 6);
    let new = pattern(MB + 12_345, 7);
    srv.file("/c.bin", Resource::new(old));
    srv.configure("/c.bin", |r| {
        r.drops.push_back(Some(300_000));
        r.replace_after_drop = Some(Resource::new(new.clone()).etag(Some("\"v2\"")));
    });
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/c.bin"));
    let v = wait_status(&engine, &id, Status::Completed, 10).await;
    assert_eq!(v.total_size, Some(new.len() as u64));
    assert_eq!(env.read("c.bin"), new);
}

#[tokio::test]
async fn changed_resource_detected_when_server_ignores_if_range() {
    let srv = TestServer::start().await;
    let old = pattern(MB, 8);
    let new = pattern(MB, 9);
    srv.file(
        "/c2.bin",
        Resource::new(old).ranges(RangeMode::IgnoreIfRange),
    );
    srv.configure("/c2.bin", |r| {
        r.drops.push_back(Some(300_000));
        r.replace_after_drop = Some(
            Resource::new(new.clone())
                .etag(Some("\"v2\""))
                .ranges(RangeMode::IgnoreIfRange),
        );
    });
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/c2.bin"));
    wait_status(&engine, &id, Status::Completed, 10).await;
    // Same length, different bytes: only the ETag check can catch this.
    assert_eq!(env.read("c2.bin"), new);
    let reqs = srv.requests("/c2.bin");
    assert_eq!(
        reqs.len(),
        3,
        "first, rejected resume, fresh restart: {reqs:?}"
    );
}

#[tokio::test]
async fn redirects_are_followed() {
    let srv = TestServer::start().await;
    let body = pattern(200_000, 11);
    srv.file("/target.bin", Resource::new(body.clone()));
    srv.route(
        "/r1",
        RouteKind::Redirect {
            status: 302,
            location: "/r2".into(),
        },
    );
    srv.route(
        "/r2",
        RouteKind::Redirect {
            status: 301,
            location: srv.url("/target.bin"),
        },
    );
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let probe = engine.probe(&srv.url("/r1"), None).await.unwrap();
    assert!(probe.redirected);
    assert_eq!(probe.suggested_name, "target.bin");
    assert_eq!(probe.total_size, Some(200_000));
    let id = add_named(&engine, srv.url("/r1"), &probe.suggested_name);
    wait_status(&engine, &id, Status::Completed, 10).await;
    assert_eq!(env.read("target.bin"), body);
}

#[tokio::test]
async fn redirect_loop_fails_clearly() {
    let srv = TestServer::start().await;
    srv.route(
        "/loop",
        RouteKind::Redirect {
            status: 302,
            location: "/loop".into(),
        },
    );
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/loop"));
    let v = wait_status(&engine, &id, Status::Failed, 10).await;
    assert_eq!(v.error.unwrap().kind, ErrorKind::Redirect);
}

#[tokio::test]
async fn unknown_length_download_completes() {
    let srv = TestServer::start().await;
    let body = pattern(700_000, 12);
    srv.file(
        "/u.bin",
        Resource::new(body.clone())
            .chunked()
            .ranges(RangeMode::Ignored),
    );
    let env = Env::new();
    let engine = env.engine(4, 3).await;
    let id = add(&engine, srv.url("/u.bin"));
    let v = wait_status(&engine, &id, Status::Completed, 10).await;
    assert_eq!(v.total_size, Some(body.len() as u64));
    assert_eq!(env.read("u.bin"), body);
}

#[tokio::test]
async fn existing_files_are_never_overwritten() {
    let srv = TestServer::start().await;
    let body = pattern(100_000, 14);
    srv.file("/data.bin", Resource::new(body.clone()));
    srv.file("/late.bin", Resource::new(body.clone()));
    let env = Env::new();
    std::fs::write(env.downloads.join("data.bin"), b"keep me").unwrap();
    let engine = env.engine(1, 3).await;

    // Collision known when adding.
    let id = add(&engine, srv.url("/data.bin"));
    let v = wait_status(&engine, &id, Status::Completed, 10).await;
    assert_eq!(v.file_name, "data (1).bin");
    assert_eq!(env.read("data.bin"), b"keep me");
    assert_eq!(env.read("data (1).bin"), body);

    // Collision that appears while downloading.
    let id = engine
        .add(AddRequest {
            url: srv.url("/late.bin"),
            start_paused: true,
            ..Default::default()
        })
        .unwrap()
        .id;
    std::fs::write(env.downloads.join("late.bin"), b"arrived later").unwrap();
    engine.resume(&id).unwrap();
    let v = wait_status(&engine, &id, Status::Completed, 10).await;
    assert_eq!(v.file_name, "late (1).bin");
    assert_eq!(env.read("late.bin"), b"arrived later");
    assert_eq!(env.read("late (1).bin"), body);
}

#[tokio::test]
async fn simultaneous_same_name_downloads_get_distinct_files() {
    let srv = TestServer::start().await;
    let body = pattern(300_000, 15);
    srv.file("/same.bin", Resource::new(body.clone()));
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let a = add(&engine, srv.url("/same.bin"));
    let b = add(&engine, srv.url("/same.bin"));
    let va = wait_status(&engine, &a, Status::Completed, 10).await;
    let vb = wait_status(&engine, &b, Status::Completed, 10).await;
    assert_ne!(va.file_name, vb.file_name);
    assert_eq!(env.read(&va.file_name), body);
    assert_eq!(env.read(&vb.file_name), body);
}

#[tokio::test]
async fn cancel_deletes_partial_data() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 16);
    srv.file("/x.bin", Resource::new(body.clone()));
    srv.configure("/x.bin", |r| {
        r.throttle = Some((8 * 1024, Duration::from_millis(5)))
    });
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/x.bin"));
    wait_for(&engine, &id, 10, |v| v.downloaded > 100_000).await;
    engine.cancel(&id).unwrap();
    let v = wait_status(&engine, &id, Status::Canceled, 10).await;
    assert_eq!(v.downloaded, 0);
    assert!(env.part_files().is_empty());
    assert!(!env.downloads.join("x.bin").exists());
    // Restarting a canceled download starts over and still produces the right file.
    engine.resume(&id).unwrap();
    wait_status(&engine, &id, Status::Completed, 20).await;
    assert_eq!(env.read("x.bin"), body);
}

#[tokio::test]
async fn remove_while_downloading_cleans_up() {
    let srv = TestServer::start().await;
    srv.file("/rm.bin", Resource::new(pattern(MB, 17)));
    srv.configure("/rm.bin", |r| {
        r.throttle = Some((8 * 1024, Duration::from_millis(5)))
    });
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/rm.bin"));
    wait_for(&engine, &id, 10, |v| v.downloaded > 50_000).await;
    engine.remove(&id, false).await.unwrap();
    assert!(engine.get(&id).is_none());
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while !env.part_files().is_empty() {
        assert!(
            tokio::time::Instant::now() < deadline,
            "partial file not removed"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(!env.downloads.join("rm.bin").exists());
}

#[tokio::test]
async fn rapid_pause_resume_never_runs_two_workers() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 18);
    srv.file("/race.bin", Resource::new(body.clone()));
    srv.configure("/race.bin", |r| {
        r.throttle = Some((16 * 1024, Duration::from_millis(3)))
    });
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/race.bin"));
    for i in 0..30 {
        engine.pause(&id).unwrap();
        engine.resume(&id).unwrap();
        if i % 3 == 0 {
            tokio::time::sleep(Duration::from_millis(15)).await;
        }
    }
    engine.cancel(&id).unwrap();
    engine.resume(&id).unwrap();
    engine.pause(&id).unwrap();
    engine.resume(&id).unwrap();
    wait_status(&engine, &id, Status::Completed, 30).await;
    assert_eq!(env.read("race.bin"), body);
    assert_eq!(
        engine.peak_workers_per_download(),
        1,
        "a second worker started before the first exited"
    );
    // A second worker would overlap for the length of a transfer; a clean
    // handover overlaps for at most the moment the server notices the hangup.
    let overlap = srv.max_overlap("/race.bin");
    assert!(
        overlap < Duration::from_millis(30),
        "requests overlapped for {overlap:?}"
    );
    assert!(env.part_files().is_empty());
}

#[tokio::test]
async fn graceful_shutdown_then_restart_resumes() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 19);
    srv.file("/g.bin", Resource::new(body.clone()));
    srv.configure("/g.bin", |r| {
        r.throttle = Some((8 * 1024, Duration::from_millis(5)))
    });
    let env = Env::new();
    let id;
    {
        let engine = env.engine(1, 3).await;
        id = add(&engine, srv.url("/g.bin"));
        wait_for(&engine, &id, 10, |v| v.downloaded > 200_000).await;
        engine.shutdown().await;
        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(engine.state_file()).unwrap()).unwrap();
        let rec = &saved["downloads"][0];
        assert_eq!(rec["status"], "queued");
        assert!(rec["layout"]["checkpoint"].as_u64().unwrap() > 0);
    }
    let engine = env.engine(1, 3).await;
    wait_status(&engine, &id, Status::Completed, 20).await;
    assert_eq!(env.read("g.bin"), body);
    let reqs = srv.requests("/g.bin");
    assert!(range_start(reqs.last().unwrap()).unwrap() > 200_000);
}

#[tokio::test]
async fn crash_recovery_discards_unconfirmed_tail() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 20);
    srv.file("/crash.bin", Resource::new(body.clone()));
    srv.configure("/crash.bin", |r| {
        r.throttle = Some((8 * 1024, Duration::from_millis(5)))
    });
    let env = Env::new();
    let (id, checkpoint, state_file);
    {
        let engine = env.engine(1, 3).await;
        id = add(&engine, srv.url("/crash.bin"));
        wait_for(&engine, &id, 10, |v| v.downloaded > 200_000).await;
        engine.pause(&id).unwrap();
        checkpoint = wait_status(&engine, &id, Status::Paused, 10)
            .await
            .downloaded;
        engine.shutdown().await;
        state_file = engine.state_file();
    }
    // Simulate a crash: garbage written past the checkpoint, and the saved
    // status still says "downloading".
    let part = env.part_files().pop().unwrap();
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&part)
            .unwrap();
        f.write_all(&vec![0xAB; 40_000]).unwrap();
    }
    let mut saved: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&state_file).unwrap()).unwrap();
    saved["downloads"][0]["status"] = "downloading".into();
    std::fs::write(&state_file, serde_json::to_vec(&saved).unwrap()).unwrap();

    // Reopen without auto-resume so the recovered state can be inspected.
    let settings_file = env.state_dir.join("settings.json");
    let mut settings: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&settings_file).unwrap()).unwrap();
    settings["autoResume"] = false.into();
    std::fs::write(&settings_file, serde_json::to_vec(&settings).unwrap()).unwrap();

    let engine = env.engine(1, 3).await;
    let recovered = engine.get(&id).unwrap();
    assert_eq!(recovered.status, Status::Paused);
    assert_eq!(recovered.downloaded, checkpoint);
    assert_eq!(
        std::fs::metadata(&part).unwrap().len(),
        checkpoint,
        "unconfirmed tail was not discarded"
    );
    engine.resume(&id).unwrap();
    wait_status(&engine, &id, Status::Completed, 20).await;
    assert_eq!(env.read("crash.bin"), body);
    assert_eq!(
        range_start(srv.requests("/crash.bin").last().unwrap()),
        Some(checkpoint)
    );
}

#[tokio::test]
async fn stalled_server_times_out_and_resumes() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 21);
    srv.file("/stall.bin", Resource::new(body.clone()));
    srv.configure("/stall.bin", |r| {
        r.stalls.push_back(Some((200_000, Duration::from_secs(3))))
    });
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/stall.bin"));
    wait_status(&engine, &id, Status::Completed, 15).await;
    assert_eq!(env.read("stall.bin"), body);
    let reqs = srv.requests("/stall.bin");
    assert_eq!(reqs.len(), 2);
    assert!(range_start(&reqs[1]).unwrap() > 0);
}

#[tokio::test]
async fn not_found_fails_without_retrying() {
    let srv = TestServer::start().await;
    srv.route("/missing", RouteKind::Status(404));
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/missing"));
    let v = wait_status(&engine, &id, Status::Failed, 10).await;
    let err = v.error.unwrap();
    assert_eq!(err.kind, ErrorKind::NotFound);
    assert!(err.message.contains("404"));
    assert_eq!(srv.requests("/missing").len(), 1);
}

#[tokio::test]
async fn transient_server_errors_are_retried() {
    let srv = TestServer::start().await;
    let body = pattern(200_000, 22);
    srv.file("/flaky.bin", Resource::new(body.clone()));
    srv.configure("/flaky.bin", |r| r.fail_statuses.extend([503, 500]));
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/flaky.bin"));
    wait_status(&engine, &id, Status::Completed, 10).await;
    assert_eq!(env.read("flaky.bin"), body);
    assert_eq!(srv.requests("/flaky.bin").len(), 3);
}

#[tokio::test]
async fn retries_are_bounded_and_partial_data_is_kept() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 23);
    srv.file("/b.bin", Resource::new(body.clone()));
    srv.configure("/b.bin", |r| {
        r.drops.push_back(Some(100_000));
        r.drops.extend([Some(0); 10]);
    });
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/b.bin"));
    let failed = wait_status(&engine, &id, Status::Failed, 10).await;
    assert_eq!(failed.error.unwrap().kind, ErrorKind::Network);
    // 1 partial + max_retries (3) attempts without progress
    assert_eq!(srv.requests("/b.bin").len(), 4);
    assert_eq!(failed.downloaded, 100_000);
    assert_eq!(
        std::fs::metadata(&env.part_files()[0]).unwrap().len(),
        100_000
    );

    srv.configure("/b.bin", |r| r.drops.clear());
    engine.resume(&id).unwrap();
    wait_status(&engine, &id, Status::Completed, 10).await;
    assert_eq!(env.read("b.bin"), body);
    assert_eq!(
        range_start(srv.requests("/b.bin").last().unwrap()),
        Some(100_000)
    );
}

#[tokio::test]
async fn segmented_download_uses_validated_ranges() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 24);
    srv.file("/seg.bin", Resource::new(body.clone()));
    let env = Env::new();
    let engine = env.engine(4, 3).await;
    let id = add(&engine, srv.url("/seg.bin"));
    wait_status(&engine, &id, Status::Completed, 10).await;
    assert_eq!(env.read("seg.bin"), body);
    let mut starts: Vec<u64> = srv
        .requests("/seg.bin")
        .iter()
        .filter_map(range_start)
        .collect();
    starts.sort();
    assert_eq!(starts, vec![0, 262_144, 524_288, 786_432]);
    assert!(srv
        .requests("/seg.bin")
        .iter()
        .skip(1)
        .all(|r| r.if_range.as_deref() == Some("\"v1\"")));
    assert!(env.part_files().is_empty());
}

#[tokio::test]
async fn segmented_download_recovers_from_a_dropped_segment() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 25);
    srv.file("/sd.bin", Resource::new(body.clone()));
    srv.configure("/sd.bin", |r| {
        r.drops.extend([None, Some(50_000), None, None])
    });
    let env = Env::new();
    let engine = env.engine(4, 3).await;
    let id = add(&engine, srv.url("/sd.bin"));
    wait_status(&engine, &id, Status::Completed, 10).await;
    assert_eq!(env.read("sd.bin"), body);
    assert!(srv.requests("/sd.bin").len() > 4);
}

#[tokio::test]
async fn segmented_pause_restart_and_resume() {
    let srv = TestServer::start().await;
    let body = pattern(2 * MB, 26);
    srv.file("/sp.bin", Resource::new(body.clone()));
    srv.configure("/sp.bin", |r| {
        r.throttle = Some((8 * 1024, Duration::from_millis(5)))
    });
    let env = Env::new();
    let id;
    {
        let engine = env.engine(4, 3).await;
        id = add(&engine, srv.url("/sp.bin"));
        wait_for(&engine, &id, 10, |v| v.downloaded > 400_000).await;
        engine.pause(&id).unwrap();
        wait_status(&engine, &id, Status::Paused, 10).await;
        engine.shutdown().await;
    }
    let engine = env.engine(4, 3).await;
    engine.resume(&id).unwrap();
    wait_status(&engine, &id, Status::Completed, 30).await;
    assert_eq!(env.read("sp.bin"), body);
    // Resumed segments only fetched what was missing.
    assert!(srv.bytes_sent("/sp.bin") < body.len() as u64 + 4 * 64 * 1024);
}

#[tokio::test]
async fn broken_content_range_falls_back_to_single_connection() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 27);
    srv.file(
        "/br.bin",
        Resource::new(body.clone()).ranges(RangeMode::BrokenContentRange),
    );
    let env = Env::new();
    let engine = env.engine(4, 3).await;
    let id = add(&engine, srv.url("/br.bin"));
    let v = wait_status(&engine, &id, Status::Completed, 10).await;
    assert_eq!(env.read("br.bin"), body);
    assert!(!v.resumable);
    assert!(srv.requests("/br.bin").last().unwrap().range.is_none());
}

#[tokio::test]
async fn queue_respects_concurrency_limit() {
    let srv = TestServer::start().await;
    let env = Env::new();
    let engine = env.engine(1, 1).await;
    let mut ids = Vec::new();
    for i in 0..3 {
        let path = format!("/q{i}.bin");
        srv.file(&path, Resource::new(pattern(150_000, 30 + i)));
        srv.configure(&path, |r| {
            r.throttle = Some((16 * 1024, Duration::from_millis(5)))
        });
        ids.push(add(&engine, srv.url(&path)));
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        let list = engine.list();
        assert!(
            list.iter()
                .filter(|v| v.status == Status::Downloading)
                .count()
                <= 1
        );
        if list.iter().all(|v| v.status == Status::Completed) {
            break;
        }
        assert!(tokio::time::Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    for i in 0..3u64 {
        assert_eq!(env.read(&format!("q{i}.bin")), pattern(150_000, 30 + i));
    }
}

#[tokio::test]
async fn unavailable_destination_is_reported() {
    let srv = TestServer::start().await;
    srv.file("/d.bin", Resource::new(pattern(1000, 40)));
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let missing = env.downloads.join("nope");
    let err = engine
        .add(AddRequest {
            url: srv.url("/d.bin"),
            dest_dir: Some(missing),
            ..Default::default()
        })
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::Destination);

    let gone = env.downloads.join("gone");
    std::fs::create_dir(&gone).unwrap();
    let id = engine
        .add(AddRequest {
            url: srv.url("/d.bin"),
            dest_dir: Some(gone.clone()),
            start_paused: true,
            ..Default::default()
        })
        .unwrap()
        .id;
    std::fs::remove_dir(&gone).unwrap();
    engine.resume(&id).unwrap();
    let v = wait_status(&engine, &id, Status::Failed, 10).await;
    assert_eq!(v.error.unwrap().kind, ErrorKind::Destination);
}

#[tokio::test]
async fn probe_uses_safe_server_filenames() {
    let srv = TestServer::start().await;
    srv.file(
        "/dl?id=1",
        Resource::new(pattern(5000, 41))
            .disposition("attachment; filename=\"x.pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"),
    );
    srv.file(
        "/evil",
        Resource::new(pattern(10, 42)).disposition("attachment; filename=\"../../evil.exe\""),
    );
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let p = engine.probe(&srv.url("/dl?id=1"), None).await.unwrap();
    assert_eq!(p.suggested_name, "résumé.pdf");
    assert_eq!(p.total_size, Some(5000));
    assert!(p.resumable);
    let p = engine.probe(&srv.url("/evil"), None).await.unwrap();
    assert_eq!(p.suggested_name, "evil.exe");
    // User-typed names with path separators are rejected outright.
    let err = engine
        .add(AddRequest {
            url: srv.url("/evil"),
            file_name: Some("..\\..\\x.exe".into()),
            ..Default::default()
        })
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
}

#[tokio::test]
async fn invalid_urls_are_rejected() {
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    for bad in [
        "ftp://example.com/a",
        "file:///C:/Windows/win.ini",
        "notaurl",
        "javascript:alert(1)",
    ] {
        let err = engine
            .add(AddRequest {
                url: bad.into(),
                ..Default::default()
            })
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput, "{bad}");
    }
}

#[tokio::test]
async fn credentials_are_not_shown() {
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let v = engine
        .add(AddRequest {
            url: "http://user:hunter2@127.0.0.1:9/file.bin?token=secret".into(),
            start_paused: true,
            ..Default::default()
        })
        .unwrap();
    assert!(!v.display_url.contains("hunter2"));
    assert!(!v.display_url.contains("secret"));
}

/// An interrupted download that the server can't continue must stop as
/// "can't resume", keep its partial data, refuse a plain resume, and only
/// start over through an explicit restart.
async fn assert_needs_restart(
    srv: &TestServer,
    env: &Env,
    engine: &fetchlane_engine::Engine,
    id: &str,
    path: &str,
    body: &[u8],
    dropped_at: u64,
) {
    let failed = wait_status(engine, id, Status::Failed, 10).await;
    assert_eq!(
        failed.error.as_ref().unwrap().kind,
        ErrorKind::CannotResume,
        "{failed:?}"
    );
    assert!(!failed.resumable);
    assert_eq!(failed.downloaded, dropped_at);
    let parts = env.part_files();
    assert_eq!(parts.len(), 1, "partial data kept");
    assert_eq!(std::fs::metadata(&parts[0]).unwrap().len(), dropped_at);
    // No automatic retry happened.
    assert_eq!(srv.requests(path).len(), 1);

    assert_eq!(engine.resume(id).unwrap_err().kind, ErrorKind::CannotResume);
    assert_eq!(
        engine.start_now(id).unwrap_err().kind,
        ErrorKind::CannotResume
    );
    engine.restart(id).unwrap();
    let done = wait_status(engine, id, Status::Completed, 10).await;
    assert_eq!(env.read(&done.file_name), body);
    assert!(env.part_files().is_empty());
    let last = srv.requests(path).last().cloned().unwrap();
    assert!(matches!(range_start(&last), None | Some(0)), "{last:?}");
    assert!(last.if_range.is_none());
}

#[tokio::test]
async fn server_ignoring_ranges_needs_explicit_restart() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 4);
    srv.file(
        "/i.bin",
        Resource::new(body.clone()).ranges(RangeMode::Ignored),
    );
    srv.configure("/i.bin", |r| r.drops.push_back(Some(300_000)));
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/i.bin"));
    assert_needs_restart(&srv, &env, &engine, &id, "/i.bin", &body, 300_000).await;
}

#[tokio::test]
async fn no_validators_means_no_resume() {
    let srv = TestServer::start().await;
    let body = pattern(MB, 10);
    srv.file("/nv.bin", Resource::new(body.clone()).no_validators());
    srv.configure("/nv.bin", |r| r.drops.push_back(Some(300_000)));
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/nv.bin"));
    assert_needs_restart(&srv, &env, &engine, &id, "/nv.bin", &body, 300_000).await;
}

#[tokio::test]
async fn unknown_length_interrupted_needs_restart() {
    let srv = TestServer::start().await;
    let body = pattern(700_000, 13);
    srv.file(
        "/u2.bin",
        Resource::new(body.clone())
            .chunked()
            .ranges(RangeMode::Ignored),
    );
    srv.configure("/u2.bin", |r| r.drops.push_back(Some(200_000)));
    let env = Env::new();
    let engine = env.engine(1, 3).await;
    let id = add(&engine, srv.url("/u2.bin"));
    assert_needs_restart(&srv, &env, &engine, &id, "/u2.bin", &body, 200_000).await;
}
