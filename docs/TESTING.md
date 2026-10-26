# Testing

Fetchlane favours correctness over features, so most behaviour is pinned by tests that run offline against local servers and peers.

## Suites

| Suite | Command | What it covers |
| --- | --- | --- |
| Engine unit tests | `cargo test -p fetchlane-engine --lib` | Name sanitization and collision-free naming, header and range parsing, redirect rules, change detection, URL redaction, error classification, retry backoff, segment planning, torrent name checks and seeding limits |
| Engine integration (`tests/engine.rs`) | `cargo test -p fetchlane-engine --test engine` | Real downloads from `tests/support`, a deterministic misbehaving HTTP server: resume with validators, changed resources, broken range support, segments, retries and timeouts, crash recovery (unconfirmed data discarded), redirects, unavailable folders, never overwriting existing files, and keeping partial data until Restart when the file changed (ETag), ranges were ignored, a `Content-Range` was invalid, or a segmented download lost range support |
| Controls (`tests/controls.rs`) | `cargo test -p fetchlane-engine --test controls` | Queue positions and moves, Pause all and its hold, Start now, refusing a pause that would lose progress, retry attempts and Retry now, restart, remove and the Recycle Bin (a fake bin), hidden link parameters, settings clamping, history |
| Torrents (`tests/torrents.rs`) | `cargo test -p fetchlane-engine --test torrents` | Local librqbit seeders on loopback (DHT and trackers off): single and multi-file, file selection, pause/resume and speed limits, recheck repairing corruption, restart with fast resume, delete scope, seeding limits, magnet details and automatic start, cancelling a magnet fetch, the active torrent limit, .torrent links over HTTP, invalid inputs |
| Shell unit tests | `cargo test -p fetchlane` | Native messaging framing and limits, link filtering for outside links, notification text and sizes |
| UI logic | `npm test` | Mapping engine states to design-system states, lists and groups, selection counts, link classification, formatting, HTML escaping |
| Browser extension (`tests/extension/`) | `npm test` | Catching is off for new users and saved choices are kept; which downloads are caught (scheme, own downloads, skipped sites, minimum size); the handoff order and giving the link back when Fetchlane can't be reached |
| Typecheck | `npm run typecheck` | The whole UI |

Rules for new tests are in [CONTRIBUTING.md](../CONTRIBUTING.md): any change to download, resume or persistence logic needs an integration test that asserts the final file contents, and a bug fix needs a test that fails without the fix.

## Flakiness

Torrent tests use real networking on loopback and short timeouts. They run in parallel and have passed 20 runs in a row; if one fails intermittently, run it alone a few times and check for timing assumptions (for example, a state that only lasts until the next scheduler tick).

## Manual and end-to-end checks

Some things only show up in the real app. Before a release:

1. **Desktop wiring.** Start the debug app with WebView2's DevTools port (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`) and drive `window.__TAURI_INTERNALS__.invoke` (add a direct download, add a .torrent paused, open details, check the delete scope, cancel a magnet fetch).
2. **Notifications.** Finish a download and check the notification says Fetchlane (not Windows PowerShell), with the name, size, folder, **Open** and **Show in folder**.
3. **Second launch.** With Fetchlane open, run `fetchlane.exe --add <link>` and `fetchlane.exe <file.torrent>`: Add download opens in the running window, a second arrival waits its turn, and only one Fetchlane process stays running.
4. **Browser extension.** Load it unpacked in Edge or Chrome; the popup shows **Connected**; starting a download opens Add download in Fetchlane and removes the browser's copy; with Fetchlane's host registration broken, the browser keeps the download and the extension shows "!".
5. **Installer.** Install, run, uninstall on a clean user account and check that the registry entries listed in [ARCHITECTURE.md](ARCHITECTURE.md#where-data-lives) are gone.
