## What and why

<!-- What does this change, and what problem does it solve? Link any issue. -->

## Checks

- [ ] `npm run build` and `npm test`
- [ ] `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace` (if Rust changed)
- [ ] Integration test added for any change to download, resume or persistence logic, asserting final file contents
- [ ] Regression test added for any bug fix (fails without the fix)
- [ ] UI follows the design system (tokens, `fl-` classes, status with icon and words, server strings escaped)
- [ ] `THIRD_PARTY_NOTICES.md` and `THIRD_PARTY_LICENSES.txt` regenerated if dependencies changed
- [ ] No telemetry, no weakened TLS, and nothing from outside the window starts a download without confirmation
