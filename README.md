<img src="assets/fetchlane/logos/fetchlane-mark-light.svg" width="64" alt="Fetchlane mark">

# Fetchlane

**Your downloads, in order.**

An open-source desktop download manager focused on one thing above all else: **files that
arrive intact**, even after dropped connections, pauses, crashes, and misbehaving servers.

Built with Rust and [Tauri 2](https://tauri.app). It is MIT-licensed, written from scratch,
and not affiliated with any commercial download manager.

> **Status:** The download engine and the desktop backend are done and tested. The user
> interface is not built yet; [`docs/IPC.md`](docs/IPC.md) describes the API it will use.

## Features (engine)

- HTTP and HTTPS downloads with streaming I/O and bounded memory (256 KiB write buffers)
- Pause, resume, cancel, retry, restart, and remove, with no pause/cancel races and never
  more than one worker per download. Pause is refused when it would lose progress.
- A queue with a configurable number of simultaneous downloads (1–10, default 4):
  - Queue positions, Move to top / up / down, and first-in-line or last-in-line adding
  - "Start now", which bypasses the limit
  - "Pause all", which holds the queue until "Resume all"
- Automatic retries with a visible countdown and attempt count ("2 of 5"), "Retry now", and
  a setting to configure or turn them off
- Safe resume: only with an `If-Range` validator and an exact `Content-Range` match. If the
  server can't continue a partial download, the download stops as **Can't resume** and
  keeps its data until you choose to restart it. It is never silently started over.
- Remove from list keeps files by default. It can optionally send completed files to the
  Recycle Bin.
- Links are shown without credentials or query parameters. The full link is available only
  through an explicit reveal or "Copy link".
- Persisted settings for theme (System/Light/Dark), density, retries, and history
- Detection of resources that changed on the server (ETag/Last-Modified) and of servers
  that ignore or break range requests
- Optional segmented downloads (1–8 connections) for servers with verified range support.
  More connections help on some servers and make no difference on others.
- Recovery after closing or crashing: saved progress counts only bytes that were fsync'd,
  and unconfirmed data is discarded on startup
- Redirects (up to 10; HTTPS→HTTP downgrades are refused), timeouts, and retries with
  bounded exponential backoff and jitter
- Safe file names: `Content-Disposition` support (including RFC 5987), protection against
  path traversal, Windows reserved names, and collision-free naming that never overwrites
  an existing file
- Clear, user-facing error messages, for example "There isn't enough free disk space" or
  "The file wasn't found on the server (HTTP 404)"
- TLS certificates verified through the OS trust store. Credentials and query strings are
  never logged or shown.

## Prerequisites (Windows)

- Rust 1.90 or newer (`rustup`, MSVC toolchain)
- Visual Studio 2022 Build Tools with "Desktop development with C++"
- Microsoft Edge WebView2 Runtime (preinstalled on Windows 10/11)
- Node.js 20 or newer (only needed for the Tauri CLI and the future UI)

On macOS and Linux, install the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your platform. The engine is portable, but only Windows has been tested.

## Development

```bash
# Engine unit tests and integration tests (local test server, no network needed)
cargo test -p fetchlane-engine

# Lints for the whole workspace
cargo clippy --workspace --all-targets

# Build and start the desktop app (opens a window that loads the dev UI URL)
cargo run -p fetchlane
```

Until the UI exists, `cargo run -p fetchlane` starts the backend and its engine (state and log
files get created), but the window has nothing to show. The UI work will add a frontend at
`http://localhost:1420` and the `beforeDevCommand`/`beforeBuildCommand` hooks; then use
`npx @tauri-apps/cli dev` for development.

## Building an installer

Once the UI is built into `dist/`:

```bash
npx @tauri-apps/cli build
```

This produces a per-user NSIS installer under `target/release/bundle/nsis/`.

## Architecture

```
crates/fetchlane-engine/       Download engine: pure Rust, no UI dependency
  src/engine.rs            Download list, queue scheduler, commands, lifecycle, recovery
  src/worker.rs            One download: requests, range validation, segments, checkpoints, finalize
  src/http.rs              Client setup (TLS, redirect policy), header parsing
  src/filename.rs          Name extraction, sanitization, collision-free naming
  src/store.rs             Atomic JSON persistence
  src/error.rs             Error classification and user-facing messages
  tests/                   Integration tests and a deterministic misbehaving HTTP server
src-tauri/                 Desktop shell: wires the engine to Tauri commands and events
docs/IPC.md                Command and event contract for the UI
assets/fetchlane/          Brand and design system: logos, line icons, tokens, component specs
```

**Design system.** `assets/fetchlane/design-system/README.md` is the brand book and the
interaction spec. It covers voice, colour tokens, status states, layout, and keyboard
behaviour. `tokens.json` is the source of truth for tokens, `components/bundle.css` is the
`fl-` class contract, and `components/bundle.js` is a reference renderer that serves as the
behaviour spec. The app icon in `src-tauri/icons/` is generated from
`assets/fetchlane/logos/fetchlane-mark-light.svg` with
`npx @tauri-apps/cli icon assets/fetchlane/logos/fetchlane-mark-light.svg`, run from `src-tauri`.

**Data flow.** The UI calls commands (`add_download`, `pause_download`, and so on). The engine
updates its state and schedules workers. Workers stream to `<name>.<id>.fetchlane-part` in the
destination folder. The engine broadcasts changes, and the shell forwards them as a
`downloads-changed` event.

**Correctness model.**

1. Each download has at most one worker. A new worker can start only after the previous one
   has exited, and every segment writer is joined first. Stop requests (pause < shutdown <
   cancel < remove) merge, so the strongest one wins.
2. Progress is recorded only after flush and `fsync`. Saved state is written atomically
   (temp file, fsync, rename). Metadata that invalidates existing data, such as a restart
   or new validators, is saved *before* any new bytes are written.
3. On startup, a single-stream partial file is truncated to its last checkpoint. A segmented
   partial file must match the expected size, or the download restarts.
4. Resume sends `Range` plus `If-Range` (a strong ETag or Last-Modified) and requires the
   `Content-Range` start, end, and total to match exactly, along with unchanged validators.
   - A `200` reply replaces the partial data from byte 0.
   - Inconsistent ranges switch that download to a single connection without ranges.
   - A changed resource restarts from zero, at most 3 times in a row.
5. Finalizing claims the final name atomically (`create_new`, numbering on collision), then
   renames the partial file over that placeholder. Existing user files are never overwritten.

**Where data lives.**

- Download list and settings: `%APPDATA%\dev.fetchlane.desktop\state\`
- Log: `%LOCALAPPDATA%\dev.fetchlane.desktop\logs\fetchlane.log` (rotated at 5 MB)

## Known limitations

- **No UI yet.** It is deferred to a separate effort.
- Responses that have neither `Content-Length` nor chunked encoding end when the connection
  closes, so a truncated transfer can't be told apart from a complete one.
- Downloads of unknown size, and resources without an ETag or Last-Modified header, can't be
  resumed safely. If they are interrupted, they need a restart from zero, and they can't be
  paused once data has arrived.
- "Change folder" for a failed download isn't supported yet. Remove the download and add it
  again in the new folder.
- With "Keep history" off, completed downloads stay in the list until Fetchlane restarts.
- `Last-Modified` has one-second granularity. A file changed twice within a second and
  served with no ETag could go undetected.
- Segments are split statically, with no work stealing, so one slow connection can delay
  completion.
- Lowering the simultaneous-download limit doesn't pause downloads that are already running.
- Fetchlane asks for uncompressed bytes (`Accept-Encoding: identity`). If a server compresses
  anyway, the file is saved exactly as sent.
- The download list stores full URLs, including any tokens, in plain JSON in your user
  profile. Logs and the UI show redacted URLs only.
- The system proxy is used, but there is no UI for proxy authentication.
- The free-space check before downloading is best-effort.
- Deferred until after the MVP: browser integration, scheduling, torrents, media
  extraction, and automatic updates.

## License

MIT. See [LICENSE](LICENSE). Third-party crates are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The Fetchlane mark, icons, and
design system in `assets/fetchlane/` belong to the Fetchlane project.
