# Architecture

Fetchlane is a Rust download engine with a thin Tauri 2 desktop shell and a TypeScript UI.
The engine has no UI dependency; the shell only adapts engine calls to commands and events.

## Code layout

```
crates/fetchlane-engine/       Download engine: pure Rust, no UI dependency
  src/engine.rs            Download list, queue scheduler, commands, lifecycle, recovery
  src/torrent.rs           Torrents: librqbit session, probes, states, seeding limits, deletion
  src/worker.rs            One download: requests, range validation, segments, checkpoints, finalize
  src/http.rs              Client setup (TLS, redirect policy), header parsing
  src/filename.rs          Name extraction, sanitization, collision-free naming
  src/store.rs             Atomic JSON persistence
  src/error.rs             Error classification and user-facing messages
  tests/                   Integration tests, a deterministic misbehaving HTTP server, local seeders
src-tauri/                 Desktop shell: wires the engine to Tauri commands and events
  src/commands.rs          Commands the UI calls (see IPC.md)
  src/notify.rs            Finish notifications (Windows toasts with Fetchlane's own identity)
  src/external.rs          Links and .torrent files from the command line or a second launch
  src/native_host.rs       Native messaging host for the browser extension
  src/integration.rs       Per-user registration: native host, Open with, magnet handler
  windows/hooks.nsh        Installer hook that removes those registrations on uninstall
browser-extension/         Chromium extension (Manifest V3) that hands links to Fetchlane
src/                       UI (TypeScript, no framework)
  app.ts                   State, rendering, live updates, actions, keyboard, menus
  views.ts                 HTML builders following the design system's class contract
  model.ts                 Maps engine data to design-system states, lists and groups
  api.ts, format.ts        Typed commands; size/speed/time formatting
  dev/preview.ts           Browser preview with sample data (development only)
docs/IPC.md                Command and event contract between the UI and the backend
assets/fetchlane/          Brand and design system: logos, line icons, tokens, component specs
```

## Design system

`assets/fetchlane/design-system/README.md` is the brand book and the interaction spec. It
covers voice, colour tokens, status states, layout and keyboard behaviour. `tokens.json` is
the source of truth for tokens, `components/bundle.css` is the `fl-` class contract, and
`components/bundle.js` is a reference renderer that serves as the behaviour spec.

The app icon in `src-tauri/icons/` is generated from
`assets/fetchlane/logos/fetchlane-mark-light.svg` with
`npx @tauri-apps/cli icon assets/fetchlane/logos/fetchlane-mark-light.svg`, run from
`src-tauri`. The browser extension icons are resized from `src-tauri/icons/icon.png`.

## UI

The UI uses the design system's `tokens.css` and `bundle.css` directly and ports the
reference renderer's markup to TypeScript. The window has a custom title bar. A list is
re-rendered only when a download's state changes; speeds, sizes, progress bars and
countdowns are updated in place, so hover and keyboard focus are never disturbed. Remote
file names and hosts are always HTML-escaped. The web view can't open files or links by
path: it asks the backend by download ID.

## Data flow

The UI calls commands (`add_download`, `pause_download` and so on). The engine updates its
state and schedules workers. Direct downloads stream to `<name>.<id>.fetchlane-part` in the
destination folder. Torrents run in one librqbit session that starts on first use, so
Fetchlane opens no network ports until a torrent is added. The engine broadcasts changes,
and the shell forwards them to the window as a `downloads-changed` event (about ten times a
second at most).

Links from outside the window (a second launch, Windows "Open with", magnet links, the
browser extension) arrive as `external-add` events and always open **Add download** for the
person to confirm. See [IPC.md](IPC.md#outside-the-window).

## Correctness model (direct downloads)

1. Each download has at most one worker. A new worker can start only after the previous one
   has exited, and every segment writer is joined first. Stop requests (pause < shutdown <
   cancel < remove) merge, so the strongest one wins.
2. Progress is recorded only after flush and `fsync`. Saved state is written atomically
   (temp file, fsync, rename). Metadata that invalidates existing data, such as a restart
   or new validators, is saved *before* any new bytes are written.
3. On startup, a single-stream partial file is truncated to its last checkpoint. A segmented
   partial file must match the expected size, or the download restarts.
4. Resume sends `Range` plus `If-Range` (a strong ETag or Last-Modified) and requires the
   `Content-Range` start, end and total to match exactly, along with unchanged validators.
   - Anything else never overwrites saved progress. A `200` reply, a changed ETag or
     Last-Modified, a different total, or a `Content-Range` that doesn't match stops the
     download as **Can't resume** with the partial file and its saved layout kept. Only
     **Restart** (confirmed by the user) deletes it. A segmented part file whose length
     doesn't match is treated the same way, including after a crash.
   - When ranges were unreliable, that's remembered across the restart, which then uses a
     single connection without ranges.
   - Within the first attempt of a new download, before any earlier progress exists, a
     changed resource or unreliable ranges restart automatically from zero (at most 3
     times in a row); only bytes from that same attempt are downloaded again.
5. Finalizing claims the final name atomically (`create_new`, numbering on collision), then
   renames the partial file over that placeholder. Existing files are never overwritten.

Other guarantees:

- Redirects are followed up to 10 times; HTTPS→HTTP downgrades are refused.
- TLS certificates are verified through the OS trust store.
- File names from `Content-Disposition` (including RFC 5987) are sanitized against path
  traversal and Windows reserved names.
- Links are shown without credentials or query parameters, and logs only contain redacted
  URLs.

## Torrents

- [librqbit](https://github.com/ikatson/rqbit) (Apache-2.0) with DHT, trackers and local
  peer discovery. UPnP is off.
- Fetchlane keeps its own torrent list (`state\torrents.json`, metainfo in
  `state\torrents\<id>.torrent`). Torrents are always handed to librqbit paused and started
  by Fetchlane's scheduler, which applies the active-torrent limit in list order and the
  seeding limits.
- **Fast resume:** librqbit stores a bitfield of verified pieces per torrent in
  `state\torrents\resume\`. Fetchlane empties librqbit's own session list before each start
  (it would otherwise re-add torrents by itself) and deletes bitfields of torrents that are
  no longer listed. A restart spot-checks the saved pieces; **Recheck files** removes the
  bitfield and verifies everything.
- New torrents get a unique output name and never write into an existing file or folder.
  File names inside a torrent are checked for Windows reserved names in addition to
  librqbit's traversal checks.
- **Delete downloaded files** only sends the torrent's own files to the Recycle Bin, then
  removes folders it left empty.

## Notifications

On Windows the shell registers `HKCU\Software\Classes\AppUserModelId\dev.fetchlane.desktop`
with the name "Fetchlane" and an icon, and shows toasts with that ID through WinRT
(`tauri-winrt-notification`). This works for the installed app and for development
builds; without it, Windows labels toasts from unpackaged apps as "Windows PowerShell".
Toast buttons (**Open**, **Show in folder**) and clicks are handled in-process while
Fetchlane runs.

## Browser integration

- The extension calls `chrome.runtime.sendNativeMessage("dev.fetchlane.host", …)`.
- The browser starts `fetchlane.exe chrome-extension://<id>/`. In that mode Fetchlane never
  opens a window: it answers length-prefixed JSON messages on stdin/stdout and, for "add",
  launches `fetchlane.exe --add <url>` detached (breaking away from the browser's job object
  when allowed).
- `tauri-plugin-single-instance` hands that launch's arguments to the running Fetchlane.
- The host manifest only allows the extension ID fixed by the public key in
  `browser-extension/manifest.json`.

## Where data lives

- Download list and settings: `%APPDATA%\dev.fetchlane.desktop\state\`
- Torrent list and saved .torrent metadata: `state\torrents.json` and `state\torrents\`
- Torrent fast-resume data: `state\torrents\resume\`
- Log: `%LOCALAPPDATA%\dev.fetchlane.desktop\logs\fetchlane.log` (rotated at 5 MB)
- Native host manifest and notification icon: `%LOCALAPPDATA%\dev.fetchlane.desktop\`
- Registry (current user only): `Software\Classes\AppUserModelId\dev.fetchlane.desktop`,
  the browsers' `NativeMessagingHosts\dev.fetchlane.host`, `Software\Classes\Fetchlane.Torrent`
  (Open with for .torrent files), and `Software\Classes\magnet` only if you turn that on.
  Uninstalling removes them.
