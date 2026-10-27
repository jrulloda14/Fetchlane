# Build and release

## Prerequisites (Windows)

- Rust 1.90 or newer (`rustup`, MSVC toolchain). CI uses 1.99.0.
- Visual Studio 2022 Build Tools with "Desktop development with C++"
- Microsoft Edge WebView2 Runtime (preinstalled on Windows 10/11)
- Node.js 24 and npm 11 (Node 20 or newer works)
- Python 3, only to regenerate third-party notices

On macOS and Linux, install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform. The engine is portable, but only Windows is tested.

## Develop

```bash
npm ci
npm run desktop:dev        # the app with hot reload (Vite + Tauri)
```

**UI preview without the backend.** `npm run dev` serves the UI at `http://localhost:1420`. Opened in a normal browser, Fetchlane installs Tauri's IPC mocks with sample downloads and torrents (`src/dev/preview.ts`), so the interface can be reviewed without Rust. The README screenshots come from this preview. The preview code is left out of production builds.

**Browser extension.** Load `browser-extension/` unpacked (see [INSTALL.md](INSTALL.md#browser-extension-chrome-edge-brave)). Running any Fetchlane build once registers that build's `fetchlane.exe` as the native host, so the extension talks to whichever build started last.

## Checks

```bash
npm run build                                          # typecheck + UI bundle (needed before Rust builds)
npm test                                               # UI logic tests (Vitest)
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace                                 # engine, torrents and shell tests
```

See [TESTING.md](TESTING.md) for what each suite covers.

## Build the installer

```bash
npm run desktop:build
```

This produces a per-user installer (no admin rights needed) at `target/release/bundle/nsis/Fetchlane_<version>_x64-setup.exe`; the app itself is `target/release/fetchlane.exe`. The installer includes the browser extension (`browser-extension/` as a resource), `LICENSE`, `THIRD_PARTY_NOTICES.md` and `THIRD_PARTY_LICENSES.txt`, and runs `src-tauri/windows/hooks.nsh`, which removes Fetchlane's per-user registry entries on uninstall.

A release build needs roughly 4 GB of free disk space for `target/`.

## Third-party notices

When dependencies change, regenerate `THIRD_PARTY_NOTICES.md` (the list) and `THIRD_PARTY_LICENSES.txt` (the license and notice texts shipped with those packages). Both, and `LICENSE`, are bundled with the installer:

```bash
python scripts/third_party_notices.py
```

## Releasing

1. Update the version in `package.json`, `src-tauri/tauri.conf.json`, `Cargo.toml` (workspace) and `browser-extension/manifest.json`, and add the release to [CHANGELOG.md](../CHANGELOG.md).
2. Commit, then tag and push: `git tag v0.1.1 && git push origin v0.1.1`. Never move or reuse a tag that already has a release; bump the version instead.
3. The **Release (draft)** workflow checks that the tag matches the app version, runs the tests, builds the Windows installer and attaches it and `SHA256SUMS.txt` to a **draft** release, using [`.github/release-notes.md`](../.github/release-notes.md) as the description.
4. Review the draft on GitHub and publish it.

Builds are unsigned until a code-signing certificate is configured, so Windows SmartScreen warns on first run.

## Continuous integration

**Windows CI** runs on every push to `main` and on pull requests: typecheck, UI tests, `cargo fmt`, clippy, all Rust tests, and an installer build kept as a workflow artifact for 14 days (not a release).
