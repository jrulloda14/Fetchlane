# Contributing to Fetchlane

Thanks for helping. Fetchlane favors correctness over features: a download manager that corrupts
one file in a thousand is worse than one that's slow.

## Setup

See the prerequisites in the README. Then:

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all
```

## Ground rules

- **The engine (`crates/fetchlane-engine`) must not depend on Tauri or the UI.** The app shell
  (`src-tauri`) only adapts engine calls to commands and events.
- **Any change to download, resume, or persistence logic needs a test in
  `crates/fetchlane-engine/tests/engine.rs`.** That test runs against the local misbehaving server
  in `tests/support/mod.rs`; extend the server if you need a new failure mode. Assert final
  file contents, not just status.
- Before a fix lands, check that its test fails without the fix.
- Never log full URLs. Use `redact::redact_url`.
- Don't add options that weaken TLS verification or follow HTTPS→HTTP redirects.
- Error messages are user-facing: plain language, no jargon, say what to do next.
- Keep dependencies few and well maintained. If you change dependencies, regenerate
  `THIRD_PARTY_NOTICES.md` with `python scripts/third_party_notices.py`.
- Contributions must be original work, or work under a license compatible with MIT.
  Don't copy code, logos, or assets from proprietary download managers.

## Pull requests

Keep PRs focused. Describe how you verified the change. CI expectation: tests, clippy, and
fmt all pass.
