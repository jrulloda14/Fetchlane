# Project status

Fetchlane is an early preview (v0.1). Windows 10 and 11 are the tested platforms. The engine
is portable Rust, but macOS and Linux builds haven't been tried.

## What's verified

| Area | How it's checked |
| --- | --- |
| Direct downloads: resume, retries, segments, recovery, naming | 46 engine integration tests against a local misbehaving HTTP server ([TESTING.md](TESTING.md)) |
| Torrents: single and multi-file, selection, pause/resume, limits, recheck, fast resume, magnet details, deletion | 12 tests with local librqbit seeders (no internet) |
| Native messaging framing, link filtering, notification text | Unit tests in `src-tauri` |
| UI model: states, lists, grouping, link checks | Vitest suite |
| Desktop app wiring | Driven end to end through WebView2's DevTools protocol: adding direct downloads and torrents, the delete confirmation scope, cancelling a magnet fetch |
| Browser extension | Loaded in Microsoft Edge: native messaging ping, catching a download, fallback to the browser when Fetchlane is unreachable |
| Notifications | Checked in the Windows notification database: sent as "Fetchlane", with name, size, folder and buttons |

Not yet verified: a long real-world torrent download and upload in the installed app, the
installer's uninstall cleanup on a clean machine, and Chrome and Brave (Edge was tested).

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
- Fetchlane doesn't get the browser's cookies or sign-in, so downloads that need them fail
  in Fetchlane. Turn catching off for those sites in the extension.
- If another app was chosen for magnet links in Windows settings, Windows keeps using it;
  choose Fetchlane there instead.
- Clicking a notification works while Fetchlane is running. After it closes, clicking an
  old notification in the notification center does nothing.

## Next

See the [roadmap](../ROADMAP.md).
