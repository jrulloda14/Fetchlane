# Project status

Fetchlane is an **early preview** (v0.1). Windows 10 and 11 are the target platforms; so far
it has been run by hand on one Windows 10 Pro PC. The engine is portable Rust, but macOS
and Linux builds haven't been tried.

## What's verified

### Automated tests (run by Windows CI on every push)

| Area | Tests |
| --- | --- |
| Direct downloads: resume with validators, changed files, broken or ignored ranges (partial data kept until Restart), segments, retries, crash recovery, naming | 48 engine integration tests against a local misbehaving HTTP server, plus 21 unit tests ([TESTING.md](TESTING.md)) |
| Torrents: single and multi-file, selection, pause/resume, limits, recheck, fast resume, magnet details, deletion, .torrent links | 12 tests with local librqbit seeders (no internet) |
| Native messaging framing, link filtering, notification text | 8 unit tests in `src-tauri` |
| UI model, and the browser extension's capture decisions (off by default, saved choices kept, handoff failure) | 22 Vitest tests |

### Checked by hand during development (October 2026, one Windows 10 Pro PC)

| Area | What was checked |
| --- | --- |
| Desktop app wiring | Driven through WebView2's DevTools protocol: adding direct downloads and torrents, the delete confirmation scope, cancelling a magnet fetch |
| Second launch | `fetchlane.exe --add <link>` and opening a .torrent file reach the running window; a second arrival waits its turn |
| Browser extension | Loaded unpacked in Microsoft Edge: native messaging ping, catching a download, the browser getting the link back when Fetchlane is unreachable |
| Notifications | Read back from the Windows notification database: sent as "Fetchlane", with name, size, folder and buttons |

### Release review (October 26, 2026)

- Windows CI passed on GitHub for the commit the v0.1.0 tag points to.
- The automated suites above were run locally after this review's fixes.
- Version 0.1.0 matches in `package.json`, `src-tauri/tauri.conf.json`, `Cargo.toml` and `browser-extension/manifest.json`.

### Not yet verified

- Installing, upgrading over an older version, and uninstalling (including removal of the registry entries) on a clean machine
- A long real-world torrent download and upload in the installed app
- Chrome and Brave (only Edge was tested)
- Clicking a notification's buttons (the buttons are sent; handling the click was only exercised through the same event the app uses)
- Windows 11

## Known limitations

### General

- Fonts: the design calls for Segoe UI Variable and Cascadia Mono. On Windows 10 these fall
  back to Segoe UI and Consolas.
- The installer isn't code-signed, so Windows SmartScreen warns on first run
  ([how to install](INSTALL.md)).
- There are no automatic updates yet.
- The download list stores full URLs, including any tokens, in plain JSON in your user
  profile. Logs and the UI show redacted URLs only.
- The system proxy is used, but there is no UI for proxy authentication.

### Direct downloads

- Responses that have neither `Content-Length` nor chunked encoding end when the connection
  closes, so a truncated transfer can't be told apart from a complete one.
- Downloads of unknown size, and resources without an ETag or Last-Modified header, can't be
  resumed safely. If they're interrupted, they need a restart from zero, and they can't be
  paused once data has arrived.
- If the file changes on the server, or the server stops answering range requests
  reliably, after progress was saved, the download stops as **Can't resume** and keeps
  its partial data. **Restart download…** (which asks first) is the only way on; on a
  server with unreliable ranges the restart uses one connection and can't be paused.
- If ranges turn out to be unreliable during the first attempt of a new download, the
  bytes from that attempt are downloaded again automatically with one connection.
- "Change folder" for a failed download isn't supported yet. Remove it and add it again.
- With "Keep history" off, completed downloads stay in the list until Fetchlane restarts.
- `Last-Modified` has one-second granularity. A file changed twice within a second and
  served with no ETag could go undetected.
- Segments are split statically, with no work stealing, so one slow connection can delay
  completion.
- Lowering the simultaneous-download limit doesn't pause downloads that are already running.
- Fetchlane asks for uncompressed bytes (`Accept-Encoding: identity`). If a server
  compresses anyway, the file is saved exactly as sent.
- The free-space check before downloading is best-effort.

### Torrents

- The details panel shows connected and known peers. librqbit doesn't report seeds
  separately, so seeds aren't counted on their own.
- Fast resume spot-checks saved progress rather than verifying every piece. If files were
  changed outside Fetchlane, use **Recheck files**.
- The first time a torrent starts, Windows Firewall may ask whether Fetchlane can accept
  incoming connections. Torrents still work if you decline, with fewer peers.
- DHT is always on. There is no setting for encryption, port forwarding (UPnP) or a proxy
  for peer connections.
- Torrents can't be reordered by dragging. The active torrent limit starts them in list order.

### Browser integration

- The extension isn't in the Chrome Web Store yet; it's added with **Load unpacked**.
  Firefox isn't supported.
- Catching browser downloads is off by default. When it's on, the browser stops its own
  download and hands **only the link** to Fetchlane: cookies, sign-in, form data and
  one-time tokens of the original request don't go with it, so such downloads can fail
  in Fetchlane. Turn catching off for those sites in the extension.
- If you choose **Cancel** in Fetchlane's Add download for a caught download, nothing is
  downloaded; the browser's copy was already stopped. Start it in the browser again.
- If Fetchlane can't be reached, the extension asks the browser to download the link
  again. That's a new request, so it may fail for links that only work once.
- If another app was chosen for magnet links in Windows settings, Windows keeps using it;
  choose Fetchlane there instead.
- Clicking a notification works while Fetchlane is running. After it closes, clicking an
  old notification in the notification center does nothing.

## Next

See the [roadmap](../ROADMAP.md).
