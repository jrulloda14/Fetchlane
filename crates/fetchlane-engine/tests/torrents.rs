//! BitTorrent tests. Each test runs a real librqbit seeder on loopback and
//! points Fetchlane at it: no DHT, no trackers, no internet.

mod support;

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use fetchlane_engine::{
    AddTorrentRequest, DownloadView, Engine, EngineConfig, Settings, TorrentConfig, TorrentSource,
    TorrentState,
};
use librqbit::spawn_utils::BlockingSpawner;
use librqbit::{
    AddTorrent, AddTorrentOptions, CreateTorrentOptions, ListenerOptions, Session, SessionOptions,
};
use support::*;

struct Seeder {
    session: Arc<Session>,
    addr: SocketAddr,
    torrent_file: PathBuf,
    torrent_bytes: Vec<u8>,
    info_hash: String,
    _dir: tempfile::TempDir,
}

/// Create `files` (relative path, contents) under a fresh folder, make a
/// torrent of `root` and seed it on 127.0.0.1.
async fn seeder(root: &str, files: &[(&str, Vec<u8>)]) -> Seeder {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    for (rel, bytes) in files {
        let p = if rel.is_empty() {
            data.join(root)
        } else {
            data.join(root).join(rel)
        };
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, bytes).unwrap();
    }
    let target = data.join(root);
    let created = librqbit::create_torrent(
        &target,
        CreateTorrentOptions {
            name: None,
            trackers: vec![],
            piece_length: Some(32 * 1024),
        },
        &BlockingSpawner::new(1),
    )
    .await
    .unwrap();
    let bytes = created.as_bytes().unwrap();
    let session = Session::new_with_opts(
        dir.path().join("seed-default"),
        SessionOptions {
            dht: None,
            disable_trackers: true,
            disable_local_service_discovery: true,
            listen: Some(ListenerOptions {
                listen_addr: "127.0.0.1:0".parse().unwrap(),
                ..Default::default()
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let handle = session
        .add_torrent(
            AddTorrent::from_bytes(bytes.clone()),
            Some(AddTorrentOptions {
                overwrite: true,
                output_folder: Some(created.output_folder.to_string_lossy().into_owned()),
                ..Default::default()
            }),
        )
        .await
        .unwrap()
        .into_handle()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(20), handle.wait_until_completed())
        .await
        .expect("seeder ready")
        .unwrap();
    let torrent_file = dir.path().join(format!("{root}.torrent"));
    std::fs::write(&torrent_file, &bytes).unwrap();
    Seeder {
        addr: session.listen_addr().expect("seeder listens"),
        session,
        torrent_file,
        torrent_bytes: bytes.to_vec(),
        info_hash: created.info_hash().as_string(),
        _dir: dir,
    }
}

fn torrent_cfg(env: &Env, peers: Vec<SocketAddr>) -> EngineConfig {
    let mut cfg = env.with_fake_bin(test_config());
    cfg.torrent = TorrentConfig {
        enable_dht: false,
        enable_trackers: false,
        listen_addr: "127.0.0.1:0".parse().unwrap(),
        extra_peers: peers,
        stall_after: Duration::from_secs(2),
        minute: Duration::from_millis(300),
        tick_interval: Duration::from_millis(100),
    };
    cfg
}

async fn open(env: &Env, peers: Vec<SocketAddr>, tweak: impl FnOnce(&mut Settings)) -> Engine {
    let engine = env.engine_with(torrent_cfg(env, peers), 1, 3).await;
    let mut s = engine.settings();
    tweak(&mut s);
    engine.update_settings(s).unwrap();
    engine
}

async fn wait_t(
    engine: &Engine,
    id: &str,
    secs: u64,
    what: &str,
    pred: impl Fn(&DownloadView) -> bool,
) -> DownloadView {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(secs);
    loop {
        if let Some(v) = engine.get(id) {
            if pred(&v) {
                return v;
            }
            if tokio::time::Instant::now() > deadline {
                panic!("timed out waiting for {what}; last: {v:#?}");
            }
        } else if tokio::time::Instant::now() > deadline {
            panic!("timed out waiting for {what}; download gone");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

fn state(v: &DownloadView) -> TorrentState {
    v.torrent.as_ref().unwrap().state
}

async fn add_file(engine: &Engine, s: &Seeder, selected: Option<Vec<usize>>) -> DownloadView {
    let preview = engine
        .probe_torrent(TorrentSource::File(s.torrent_file.clone()), "p1", None)
        .await
        .unwrap();
    engine
        .add_torrent(AddTorrentRequest {
            probe_id: Some(preview.probe_id),
            selected,
            ..Default::default()
        })
        .await
        .unwrap()
}

fn read(p: impl AsRef<Path>) -> Vec<u8> {
    std::fs::read(p.as_ref()).unwrap_or_else(|e| panic!("reading {}: {e}", p.as_ref().display()))
}

#[tokio::test(flavor = "multi_thread")]
async fn single_file_torrent_downloads_and_seeds() {
    let body = pattern(3 * 1024 * 1024 + 123, 1);
    let s = seeder("movie.bin", &[("", body.clone())]).await;
    let env = Env::new();
    let engine = open(&env, vec![s.addr], |_| {}).await;

    let preview = engine
        .probe_torrent(TorrentSource::File(s.torrent_file.clone()), "p1", None)
        .await
        .unwrap();
    assert_eq!(preview.name, "movie.bin");
    assert_eq!(preview.files.len(), 1);
    assert_eq!(preview.total_size, body.len() as u64);
    assert_eq!(preview.save_as, "movie.bin");
    assert_eq!(preview.info_hash, s.info_hash);

    let v = engine
        .add_torrent(AddTorrentRequest {
            probe_id: Some(preview.probe_id),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(v.kind, fetchlane_engine::DownloadKind::Torrent);
    let done = wait_t(&engine, &v.id, 30, "seeding", |v| {
        state(v) == TorrentState::Seeding
    })
    .await;
    assert_eq!(done.downloaded, body.len() as u64);
    assert!(done.completed_at.is_some());
    assert_eq!(read(env.downloads.join("movie.bin")), body);
    assert_eq!(
        engine.completed_file(&v.id).unwrap(),
        env.downloads.join("movie.bin")
    );

    // The same torrent can't be added twice.
    let again = engine
        .probe_torrent(TorrentSource::File(s.torrent_file.clone()), "p2", None)
        .await;
    assert!(again.unwrap_err().message.contains("already in your list"));
    drop(s.session);
}

#[tokio::test(flavor = "multi_thread")]
async fn multi_file_selection_downloads_only_chosen_files() {
    let a = pattern(700_000, 2);
    let b = pattern(900_000, 3);
    let c = pattern(500_000, 4);
    let s = seeder(
        "pack",
        &[("a.bin", a.clone()), ("sub/b.bin", b), ("c.bin", c.clone())],
    )
    .await;
    let env = Env::new();
    // A folder with the torrent's name already exists: never write into it.
    std::fs::create_dir(env.downloads.join("pack")).unwrap();
    let engine = open(&env, vec![s.addr], |_| {}).await;

    let preview = engine
        .probe_torrent(TorrentSource::File(s.torrent_file.clone()), "p1", None)
        .await
        .unwrap();
    assert_eq!(preview.save_as, "pack (1)");
    let paths: Vec<&str> = preview.files.iter().map(|f| f.path.as_str()).collect();
    let idx = |name: &str| paths.iter().position(|p| *p == name).unwrap();
    let selected = vec![idx("a.bin"), idx("c.bin")];
    let v = engine
        .add_torrent(AddTorrentRequest {
            probe_id: Some(preview.probe_id),
            selected: Some(selected.clone()),
            ..Default::default()
        })
        .await
        .unwrap();
    let done = wait_t(&engine, &v.id, 30, "seeding", |v| {
        state(v) == TorrentState::Seeding
    })
    .await;
    assert_eq!(done.total_size, Some((a.len() + c.len()) as u64));
    let out = env.downloads.join("pack (1)");
    assert_eq!(read(out.join("a.bin")), a);
    assert_eq!(read(out.join("c.bin")), c);
    assert!(
        std::fs::read_dir(env.downloads.join("pack"))
            .unwrap()
            .next()
            .is_none(),
        "existing folder untouched"
    );

    let d = engine.torrent_details(&v.id).unwrap();
    assert_eq!(d.files.len(), 3);
    for f in &d.files {
        assert_eq!(f.selected, selected.contains(&f.index), "{f:?}");
        if f.selected {
            assert_eq!(f.have, f.size);
        }
    }
    assert_eq!(d.save_path, out);
    assert_eq!(v.torrent.as_ref().unwrap().selected_count, 2);

    // Selecting the remaining file downloads it too.
    engine
        .set_torrent_files(&v.id, vec![0, 1, 2])
        .await
        .unwrap();
    wait_t(&engine, &v.id, 30, "all files", |v| {
        state(v) == TorrentState::Seeding && v.downloaded == 2_100_000
    })
    .await;
    assert!(out.join("sub").join("b.bin").is_file());
}

#[tokio::test(flavor = "multi_thread")]
async fn pause_resume_and_speed_limit() {
    let body = pattern(2 * 1024 * 1024, 5);
    let s = seeder("slow.bin", &[("", body.clone())]).await;
    let env = Env::new();
    let engine = open(&env, vec![s.addr], |s| s.torrent_download_limit_kib = 400).await;
    let v = add_file(&engine, &s, None).await;
    wait_t(&engine, &v.id, 20, "progress", |v| v.downloaded > 100_000).await;
    engine.pause(&v.id).unwrap();
    let paused = wait_t(&engine, &v.id, 10, "paused", |v| {
        state(v) == TorrentState::Paused
    })
    .await;
    assert!(
        paused.downloaded < body.len() as u64,
        "limit should keep it from finishing"
    );
    tokio::time::sleep(Duration::from_millis(700)).await;
    let still = engine.get(&v.id).unwrap();
    assert!(
        still.downloaded <= paused.downloaded + 64 * 1024,
        "no progress while paused"
    );

    let mut s2 = engine.settings();
    s2.torrent_download_limit_kib = 0;
    engine.update_settings(s2).unwrap();
    engine.resume(&v.id).unwrap();
    wait_t(&engine, &v.id, 30, "seeding", |v| {
        state(v) == TorrentState::Seeding
    })
    .await;
    assert_eq!(read(env.downloads.join("slow.bin")), body);
}

#[tokio::test(flavor = "multi_thread")]
async fn recheck_repairs_corrupted_data() {
    let body = pattern(1024 * 1024, 6);
    let s = seeder("fix.bin", &[("", body.clone())]).await;
    let env = Env::new();
    let engine = open(&env, vec![s.addr], |_| {}).await;
    let v = add_file(&engine, &s, None).await;
    wait_t(&engine, &v.id, 30, "seeding", |v| {
        state(v) == TorrentState::Seeding
    })
    .await;

    // Stop seeding so the file is closed, then damage it.
    engine.pause(&v.id).unwrap();
    wait_t(&engine, &v.id, 10, "stopped", |v| {
        state(v) == TorrentState::Stopped
    })
    .await;
    let path = env.downloads.join("fix.bin");
    let mut bytes = read(&path);
    bytes[500_000] ^= 0xFF;
    std::fs::write(&path, &bytes).unwrap();

    engine.recheck(&v.id).await.unwrap();
    engine.resume(&v.id).unwrap();
    wait_t(&engine, &v.id, 30, "repaired", |v| {
        state(v) == TorrentState::Seeding
    })
    .await;
    assert_eq!(read(&path), body);
}

#[tokio::test(flavor = "multi_thread")]
async fn restart_restores_from_disk_without_peers() {
    let body = pattern(1024 * 1024, 7);
    let s = seeder("keep.bin", &[("", body.clone())]).await;
    let env = Env::new();
    let id;
    {
        let engine = open(&env, vec![s.addr], |_| {}).await;
        id = add_file(&engine, &s, None).await.id;
        wait_t(&engine, &id, 30, "seeding", |v| {
            state(v) == TorrentState::Seeding
        })
        .await;
        engine.shutdown().await;
    }
    drop(s.session); // no peers any more
    let engine = open(&env, vec![], |_| {}).await;
    let v = wait_t(&engine, &id, 30, "restored seeding", |v| {
        state(v) == TorrentState::Seeding
    })
    .await;
    assert_eq!(v.downloaded, body.len() as u64);
    assert_eq!(read(env.downloads.join("keep.bin")), body);
}

#[tokio::test(flavor = "multi_thread")]
async fn delete_files_uses_recycle_bin_and_reports_scope() {
    let s = seeder(
        "album",
        &[
            ("01.flac", pattern(300_000, 8)),
            ("02.flac", pattern(300_000, 9)),
        ],
    )
    .await;
    let env = Env::new();
    let engine = open(&env, vec![s.addr], |_| {}).await;
    let v = add_file(&engine, &s, None).await;
    wait_t(&engine, &v.id, 30, "seeding", |v| {
        state(v) == TorrentState::Seeding
    })
    .await;

    let scope = engine.delete_scope(&v.id).unwrap();
    assert_eq!(scope.file_count, 2);
    assert_eq!(scope.total_bytes, 600_000);
    assert_eq!(scope.folder, env.downloads.join("album"));

    // Remove from list keeps files...
    let user_file = env.downloads.join("album").join("my-notes.txt");
    std::fs::write(&user_file, b"mine").unwrap();
    engine.remove(&v.id, true).await.unwrap();
    assert!(engine.get(&v.id).is_none());
    // ...and delete only touches the torrent's own files.
    assert!(env.bin.join("01.flac").is_file());
    assert!(env.bin.join("02.flac").is_file());
    assert!(
        user_file.is_file(),
        "files the torrent didn't create are kept"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn seeding_stops_at_time_limit_until_resumed() {
    let s = seeder("seed.bin", &[("", pattern(500_000, 10))]).await;
    let env = Env::new();
    let engine = open(&env, vec![s.addr], |st| {
        st.seed_ratio_enabled = false;
        st.seed_time_enabled = true;
        st.seed_time_minutes = 1; // 300 ms in tests
    })
    .await;
    let v = add_file(&engine, &s, None).await;
    let stopped = wait_t(&engine, &v.id, 30, "limit", |v| {
        state(v) == TorrentState::Stopped
    })
    .await;
    assert!(stopped.torrent.as_ref().unwrap().seed_limit_reached);
    let d = engine.torrent_details(&v.id).unwrap();
    assert_eq!(d.time_limit_minutes, Some(1));
    assert!(d.seeded_secs >= 60);

    // Starting it again seeds past the limit until it is stopped again.
    engine.resume(&v.id).unwrap();
    wait_t(&engine, &v.id, 10, "seeding again", |v| {
        state(v) == TorrentState::Seeding
    })
    .await;
    tokio::time::sleep(Duration::from_millis(800)).await;
    assert_eq!(state(&engine.get(&v.id).unwrap()), TorrentState::Seeding);
    engine.pause(&v.id).unwrap();
    wait_t(&engine, &v.id, 10, "stopped by user", |v| {
        state(v) == TorrentState::Stopped
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn magnet_details_then_automatic_start() {
    let body = pattern(600_000, 11);
    let s = seeder("mag.bin", &[("", body.clone())]).await;
    let env = Env::new();
    let engine = open(&env, vec![s.addr], |_| {}).await;
    let magnet = format!("magnet:?xt=urn:btih:{}&dn=mag.bin", s.info_hash);

    let preview = engine
        .probe_torrent(TorrentSource::Magnet(magnet.clone()), "m1", None)
        .await
        .unwrap();
    assert_eq!(preview.name, "mag.bin");
    assert_eq!(preview.total_size, body.len() as u64);
    engine.cancel_torrent_probe("m1");

    // "Start automatically after fetching details".
    let v = engine
        .add_torrent(AddTorrentRequest {
            magnet: Some(magnet.clone()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(matches!(
        state(&v),
        TorrentState::Fetching
            | TorrentState::Checking
            | TorrentState::Connecting
            | TorrentState::Downloading
    ));
    wait_t(&engine, &v.id, 30, "seeding", |v| {
        state(v) == TorrentState::Seeding
    })
    .await;
    assert_eq!(read(env.downloads.join("mag.bin")), body);
    assert_eq!(engine.source_url(&v.id).unwrap(), magnet);
    let _ = s.torrent_bytes;
}

#[tokio::test(flavor = "multi_thread")]
async fn fetching_magnet_details_can_be_cancelled() {
    // A "peer" that accepts connections and never answers.
    let silent = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = silent.local_addr().unwrap();
    tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((sock, _)) = silent.accept().await {
            held.push(sock);
        }
    });
    let env = Env::new();
    let engine = Arc::new(open(&env, vec![addr], |_| {}).await);
    let magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567".to_string();
    let e2 = engine.clone();
    let probe = tokio::spawn(async move {
        e2.probe_torrent(TorrentSource::Magnet(magnet), "slow", None)
            .await
    });
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(!probe.is_finished(), "should still be fetching");
    engine.cancel_torrent_probe("slow");
    let res = tokio::time::timeout(Duration::from_secs(3), probe)
        .await
        .expect("cancel is quick")
        .unwrap();
    assert!(res.unwrap_err().message.contains("cancelled"));
}

#[tokio::test(flavor = "multi_thread")]
async fn active_torrent_limit_queues_the_rest() {
    let s1 = seeder("one.bin", &[("", pattern(1024 * 1024, 12))]).await;
    let s2 = seeder("two.bin", &[("", pattern(1024 * 1024, 13))]).await;
    let env = Env::new();
    let engine = open(&env, vec![s1.addr, s2.addr], |s| {
        s.max_active_torrents = 1;
        s.torrent_download_limit_kib = 300;
    })
    .await;
    let a = add_file(&engine, &s1, None).await;
    let preview = engine
        .probe_torrent(TorrentSource::File(s2.torrent_file.clone()), "p2", None)
        .await
        .unwrap();
    let b = engine
        .add_torrent(AddTorrentRequest {
            probe_id: Some(preview.probe_id),
            ..Default::default()
        })
        .await
        .unwrap();
    wait_t(&engine, &a.id, 20, "first running", |v| v.downloaded > 0).await;
    let qb = wait_t(&engine, &b.id, 10, "second queued", |v| {
        state(v) == TorrentState::Queued
    })
    .await;
    let qa = engine.get(&a.id).unwrap();
    assert_eq!(
        qb.queue_position,
        Some(1),
        "a: {:?} {:?} / b: {:?}",
        state(&qa),
        qa.queue_position,
        state(&qb)
    );
    // Start now overrides the limit.
    engine.start_now(&b.id).unwrap();
    wait_t(&engine, &b.id, 20, "second running", |v| {
        matches!(
            state(v),
            TorrentState::Downloading | TorrentState::Connecting
        ) && v.downloaded > 0
    })
    .await;
    let mut s = engine.settings();
    s.torrent_download_limit_kib = 0;
    engine.update_settings(s).unwrap();
    wait_t(&engine, &a.id, 30, "a done", |v| {
        state(v) == TorrentState::Seeding
    })
    .await;
    wait_t(&engine, &b.id, 30, "b done", |v| {
        state(v) == TorrentState::Seeding
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn invalid_inputs_are_explained() {
    let env = Env::new();
    let engine = open(&env, vec![], |_| {}).await;
    let bad_magnet = engine
        .probe_torrent(TorrentSource::Magnet("magnet:?nothing".into()), "x", None)
        .await;
    assert_eq!(
        bad_magnet.unwrap_err().message,
        "That magnet link isn't valid."
    );
    let txt = env.downloads.join("notes.txt");
    std::fs::write(&txt, b"hello").unwrap();
    let not_torrent = engine
        .probe_torrent(TorrentSource::File(txt), "y", None)
        .await;
    assert_eq!(not_torrent.unwrap_err().message, "Choose a .torrent file.");
    let junk = env.downloads.join("junk.torrent");
    std::fs::write(&junk, b"not bencode").unwrap();
    assert!(engine
        .probe_torrent(TorrentSource::File(junk), "z", None)
        .await
        .is_err());
    let expired = engine
        .add_torrent(AddTorrentRequest {
            probe_id: Some("gone".into()),
            ..Default::default()
        })
        .await;
    assert!(expired.unwrap_err().message.contains("expired"));
}
