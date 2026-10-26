# Contributing to Fetchlane

Thanks for helping. Fetchlane favours correctness over features: a download manager that corrupts one file in a thousand is worse than one that's slow.

## Setup

Install the prerequisites in [BUILD_AND_RELEASE.md](docs/BUILD_AND_RELEASE.md#prerequisites-windows). Then:

```bash
npm ci
npm run desktop:dev        # the app, with hot reload
```

To work on the UI without Rust, run `npm run dev` and open http://localhost:1420 in a browser. It shows sample data (see `src/dev/preview.ts`).

Before opening a pull request:

```bash
npm run build && npm test
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

[TESTING.md](docs/TESTING.md) describes each suite and the manual checks for the desktop app and the browser extension. [ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit together, and [IPC.md](docs/IPC.md) is the contract between the UI and the backend.

## Ground rules

- **The engine (`crates/fetchlane-engine`) must not depend on Tauri or the UI.** The app shell (`src-tauri`) only adapts engine calls to commands and events.
- **Any change to download, resume or persistence logic needs a test** in `crates/fetchlane-engine/tests/`. Direct-download tests run against the local misbehaving server in `tests/support/mod.rs`; extend the server if you need a new failure mode. Torrent tests use local seeders. Assert final file contents, not just status.
- Before a fix lands, check that its test fails without the fix.
- Never log full URLs. Use `redact::redact_url`.
- Don't add options that weaken TLS verification or follow HTTPS→HTTP redirects.
- Links from outside the window (browser, command line) must always open Add download for the person to confirm. Never start a download on their behalf.
- Error messages are user-facing: plain language, no jargon, say what to do next.
- UI work follows `assets/fetchlane/design-system/README.md`: tokens and `fl-` classes only, sentence case, status shown with an icon and words (never colour alone), and confirmations that state what will be lost. Escape every server-provided string with `esc()`.
- Keep dependencies few and well maintained. If you change dependencies, regenerate `THIRD_PARTY_NOTICES.md` with `python scripts/third_party_notices.py`.
- Contributions must be original work, or work under a license compatible with MIT. Don't copy code, logos or assets from proprietary download managers.

## Pull requests

Keep PRs focused, describe how you verified the change, and fill in the checklist in the pull request template. CI runs the typecheck, tests, `cargo fmt`, clippy and an installer build on Windows.

## Reporting bugs and ideas

Use the [issue templates](https://github.com/jrulloda14/Fetchlane/issues/new/choose). For security problems, follow [SECURITY.md](SECURITY.md) instead.
